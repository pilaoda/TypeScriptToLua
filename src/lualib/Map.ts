export class Map<K extends AnyNotNil, V> {
    public static [Symbol.species] = Map;
    public [Symbol.toStringTag] = "Map";

    public size = 0;

    // Flat array storage (1-based indices for Lua)
    private keyIndex = new LuaTable<K, number>();
    private orderedKeys = new LuaTable<number, K>();
    private orderedValues = new LuaTable<number, V>();
    private nextSlot = 1;

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
    }

    public delete(key: K): boolean {
        const idx = this.keyIndex.get(key);
        if (idx === undefined) return false;
        this.size--;
        this.keyIndex.set(key, undefined!);
        this.orderedKeys.set(idx, undefined!);
        this.orderedValues.set(idx, undefined!);
        return true;
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
        const { orderedKeys, orderedValues } = this;
        const getNextSlot = () => this.nextSlot;
        let idx = 0;
        return {
            [Symbol.iterator](): IterableIterator<[K, V]> {
                return this;
            },
            next(): IteratorResult<[K, V]> {
                idx++;
                while (idx < getNextSlot() && orderedKeys.get(idx) === undefined) {
                    idx++;
                }
                if (idx >= getNextSlot()) {
                    return { done: true, value: undefined! };
                }
                return { done: false, value: [orderedKeys.get(idx)!, orderedValues.get(idx)] as [K, V] };
            },
        };
    }

    public keys(): IterableIterator<K> {
        const { orderedKeys } = this;
        const getNextSlot = () => this.nextSlot;
        let idx = 0;
        return {
            [Symbol.iterator](): IterableIterator<K> {
                return this;
            },
            next(): IteratorResult<K> {
                idx++;
                while (idx < getNextSlot() && orderedKeys.get(idx) === undefined) {
                    idx++;
                }
                if (idx >= getNextSlot()) {
                    return { done: true, value: undefined! };
                }
                return { done: false, value: orderedKeys.get(idx)! };
            },
        };
    }

    public values(): IterableIterator<V> {
        const { orderedKeys, orderedValues } = this;
        const getNextSlot = () => this.nextSlot;
        let idx = 0;
        return {
            [Symbol.iterator](): IterableIterator<V> {
                return this;
            },
            next(): IteratorResult<V> {
                idx++;
                while (idx < getNextSlot() && orderedKeys.get(idx) === undefined) {
                    idx++;
                }
                if (idx >= getNextSlot()) {
                    return { done: true, value: undefined! };
                }
                return { done: false, value: orderedValues.get(idx) };
            },
        };
    }
}
