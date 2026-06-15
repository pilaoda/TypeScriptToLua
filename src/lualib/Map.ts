// Insertion-ordered Map using flat arrays with tombstone deletion and
// V8-style version chain compaction. Deleted entries become nil (tombstones);
// iterators skip them via idx++. Compaction creates new arrays and links
// old → new at index 0; iterators transition lazily by adjusting their
// index (subtracting holes before current position).
//
// Based on V8's OrderedHashTable:
//   Rehash:     https://chromium.googlesource.com/v8/v8/+/main/src/objects/ordered-hash-table.cc#263
//   Transition: https://chromium.googlesource.com/v8/v8/+/main/src/objects/ordered-hash-table.cc#1443
//   Tests:      https://chromium.googlesource.com/v8/v8/+/main/test/mjsunit/es6/collection-iterator.js
export class Map<K extends AnyNotNil, V> {
    public static [Symbol.species] = Map;
    public [Symbol.toStringTag] = "Map";

    public size = 0;

    // Flat array storage (1-based indices for Lua)
    private keyIndex = new LuaTable<K, number>();
    private orderedKeys = new LuaTable<number, K>();
    private orderedValues = new LuaTable<number, V>();
    private nextSlot = 1;
    private deletedCount = 0;

    constructor(entries?: Iterable<readonly [K, V]> | Array<readonly [K, V]>) {
        if (entries === undefined) return;

        const iterable = entries as Iterable<[K, V]>;
        if (iterable[Symbol.iterator]) {
            // Iterate manually because Map is compiled with ES5 which doesn't support Iterables in for...of
            const iterator = iterable[Symbol.iterator]();
            while (true) {
                const result = iterator.next();
                if (result.done) {
                    break;
                }

                const value: [K, V] = result.value; // Ensures index is offset when tuple is accessed
                this.set(value[0], value[1]);
            }
        } else {
            const array = entries as Array<[K, V]>;
            for (const kvp of array) {
                this.set(kvp[0], kvp[1]);
            }
        }
    }

    public clear(): void {
        this.keyIndex = new LuaTable();
        this.orderedKeys = new LuaTable();
        this.orderedValues = new LuaTable();
        this.nextSlot = 1;
        this.size = 0;
        this.deletedCount = 0;
    }

    public delete(key: K): boolean {
        const idx = this.keyIndex.get(key);
        if (idx === undefined) return false;
        this.size--;
        this.deletedCount++;
        this.keyIndex.set(key, undefined!);
        this.orderedKeys.set(idx, undefined!);
        this.orderedValues.set(idx, undefined!);

        if (this.deletedCount > this.size) {
            this.compact();
        }
        return true;
    }

    // V8-style compaction: copy live entries to new arrays, record hole
    // positions in the old array at negative indices, link old[0] → new.
    // Active iterators hold old arrays and transition lazily on next().
    private compact(): void {
        const oldKeys = this.orderedKeys;
        const oldValues = this.orderedValues;
        const oldNextSlot = this.nextSlot;
        const newKeys = new LuaTable<number, K>();
        const newValues = new LuaTable<number, V>();
        let newSlot = 1;
        let holeCount = 0;

        for (let i = 1; i < oldNextSlot; i++) {
            const k = oldKeys.get(i);
            if (k !== undefined) {
                newKeys.set(newSlot, k);
                newValues.set(newSlot, oldValues.get(i));
                this.keyIndex.set(k, newSlot);
                newSlot++;
            } else {
                holeCount++;
                oldKeys.set(-holeCount as any, i as any);
            }
        }

        oldKeys.set(0 as any, newKeys as any);
        oldValues.set(0 as any, newValues as any);

        this.orderedKeys = newKeys;
        this.orderedValues = newValues;
        this.nextSlot = newSlot;
        this.deletedCount = 0;
    }

    public forEach(callback: (value: V, key: K, map: Map<K, V>) => any): void {
        for (const key of this.keys()) {
            callback(this.orderedValues.get(this.keyIndex.get(key)!), key, this);
        }
    }

    public get(key: K): V | undefined {
        const idx = this.keyIndex.get(key);
        if (idx === undefined) return undefined;
        return this.orderedValues.get(idx);
    }

    public has(key: K): boolean {
        return this.keyIndex.get(key) !== undefined;
    }

    public set(key: K, value: V): this {
        const existingIdx = this.keyIndex.get(key);
        if (existingIdx !== undefined) {
            this.orderedValues.set(existingIdx, value);
        } else {
            this.size++;
            const idx = this.nextSlot;
            this.nextSlot = idx + 1;
            this.keyIndex.set(key, idx);
            this.orderedKeys.set(idx, key);
            this.orderedValues.set(idx, value);
        }
        return this;
    }

    public [Symbol.iterator](): IterableIterator<[K, V]> {
        return this.entries();
    }

    public entries(): IterableIterator<[K, V]> {
        let keys = this.orderedKeys;
        let vals = this.orderedValues;
        const getNextSlot = () => this.nextSlot;
        let idx = 1;
        return {
            [Symbol.iterator](): IterableIterator<[K, V]> {
                return this;
            },
            next(): IteratorResult<[K, V]> {
                while (keys.get(0 as any) !== undefined) {
                    let adj = 0;
                    let h = 1;
                    while (true) {
                        const holePos: number = keys.get(-h as any) as any;
                        if (holePos === undefined || holePos >= idx) break;
                        adj++;
                        h++;
                    }
                    idx -= adj;
                    keys = keys.get(0 as any) as any;
                    vals = vals.get(0 as any) as any;
                }
                while (idx < getNextSlot() && keys.get(idx) === undefined) {
                    idx++;
                }
                if (idx >= getNextSlot()) {
                    return { done: true, value: undefined! };
                }
                const i = idx;
                idx++;
                return { done: false, value: [keys.get(i)!, vals.get(i)] as [K, V] };
            },
        };
    }

    public keys(): IterableIterator<K> {
        let keys = this.orderedKeys;
        const getNextSlot = () => this.nextSlot;
        let idx = 1;
        return {
            [Symbol.iterator](): IterableIterator<K> {
                return this;
            },
            next(): IteratorResult<K> {
                while (keys.get(0 as any) !== undefined) {
                    let adj = 0;
                    let h = 1;
                    while (true) {
                        const holePos: number = keys.get(-h as any) as any;
                        if (holePos === undefined || holePos >= idx) break;
                        adj++;
                        h++;
                    }
                    idx -= adj;
                    keys = keys.get(0 as any) as any;
                }
                while (idx < getNextSlot() && keys.get(idx) === undefined) {
                    idx++;
                }
                if (idx >= getNextSlot()) {
                    return { done: true, value: undefined! };
                }
                const i = idx;
                idx++;
                return { done: false, value: keys.get(i)! };
            },
        };
    }

    public values(): IterableIterator<V> {
        let keys = this.orderedKeys;
        let vals = this.orderedValues;
        const getNextSlot = () => this.nextSlot;
        let idx = 1;
        return {
            [Symbol.iterator](): IterableIterator<V> {
                return this;
            },
            next(): IteratorResult<V> {
                while (keys.get(0 as any) !== undefined) {
                    let adj = 0;
                    let h = 1;
                    while (true) {
                        const holePos: number = keys.get(-h as any) as any;
                        if (holePos === undefined || holePos >= idx) break;
                        adj++;
                        h++;
                    }
                    idx -= adj;
                    keys = keys.get(0 as any) as any;
                    vals = vals.get(0 as any) as any;
                }
                while (idx < getNextSlot() && keys.get(idx) === undefined) {
                    idx++;
                }
                if (idx >= getNextSlot()) {
                    return { done: true, value: undefined! };
                }
                const i = idx;
                idx++;
                return { done: false, value: vals.get(i) };
            },
        };
    }
}
