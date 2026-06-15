export class Map<K extends AnyNotNil, V> {
    public static [Symbol.species] = Map;
    public [Symbol.toStringTag] = "Map";

    private items = new LuaTable<K, V>();
    private keySet = new LuaTable<K, true>();
    public size = 0;

    // Key-order doubly-linked list (weak-key tables)
    private firstKey: K | undefined;
    private lastKey: K | undefined;
    private nextKey = new LuaTable<K, K>();
    private previousKey = new LuaTable<K, K>();
    private deletedCount = 0;

    constructor(entries?: Iterable<readonly [K, V]> | Array<readonly [K, V]>) {
        setmetatable(this.nextKey, { __mode: "k" });
        setmetatable(this.previousKey, { __mode: "k" });
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
        this.items = new LuaTable();
        this.keySet = new LuaTable();
        this.nextKey = new LuaTable();
        this.previousKey = new LuaTable();
        setmetatable(this.nextKey, { __mode: "k" });
        setmetatable(this.previousKey, { __mode: "k" });
        this.firstKey = undefined;
        this.lastKey = undefined;
        this.size = 0;
        this.deletedCount = 0;
    }

    public delete(key: K): boolean {
        const contains = this.has(key);
        if (contains) {
            this.size--;
            this.deletedCount++;
            this.keySet.set(key, undefined!);

            const next = this.nextKey.get(key);
            const previous = this.previousKey.get(key);

            // Update firstKey/lastKey, skipping deleted entries
            if (key === this.firstKey) {
                let fk = next;
                while (fk !== undefined && this.keySet.get(fk) !== true) {
                    fk = this.nextKey.get(fk);
                }
                this.firstKey = fk;
            }
            if (key === this.lastKey) {
                let lk = previous;
                while (lk !== undefined && this.keySet.get(lk) !== true) {
                    lk = this.previousKey.get(lk);
                }
                this.lastKey = lk;
            }

            // Only relink when both neighbors exist (middle key deletion)
            if (previous !== undefined && next !== undefined) {
                this.nextKey.set(previous, next);
                this.previousKey.set(next, previous);
            }

            // Don't clear nextKey[key] or previousKey[key]:
            // active iterators need forward pointers to traverse past deleted entries

            // Compaction deferred: version chain needed for safe multi-compaction
        }
        this.items.set(key, undefined!);

        return contains;
    }

    private compact(): void {
        const oldNextKey = this.nextKey;
        const oldPreviousKey = this.previousKey;
        const newNextKey = new LuaTable<K, K>();
        const newPreviousKey = new LuaTable<K, K>();
        setmetatable(newNextKey, { __mode: "k" });
        setmetatable(newPreviousKey, { __mode: "k" });

        // Copy live chain to new tables
        let k = this.firstKey;
        while (k !== undefined) {
            const n = oldNextKey.get(k);
            if (n !== undefined) {
                newNextKey.set(k, n);
                newPreviousKey.set(n, k);
            }
            k = n;
        }

        // Clear live entries from old tables so old iterators
        // fall through to getCurrentNextKey() at live keys
        k = this.firstKey;
        while (k !== undefined) {
            const n = newNextKey.get(k);
            oldNextKey.set(k, undefined!);
            oldPreviousKey.set(k, undefined!);
            k = n;
        }

        this.nextKey = newNextKey;
        this.previousKey = newPreviousKey;
        this.deletedCount = 0;
    }

    public forEach(callback: (value: V, key: K, map: Map<K, V>) => any): void {
        for (const key of this.keys()) {
            callback(this.items.get(key), key, this);
        }
    }

    public get(key: K): V | undefined {
        return this.items.get(key);
    }

    public has(key: K): boolean {
        return this.keySet.get(key) === true;
    }

    public set(key: K, value: V): this {
        const isNewValue = !this.has(key);
        if (isNewValue) {
            this.size++;
            this.keySet.set(key, true);

            // Fix stale forward pointer from predecessor (if re-adding a deleted key)
            const stalePrev = this.previousKey.get(key);
            const staleNext = this.nextKey.get(key);
            if (stalePrev !== undefined && staleNext !== undefined) {
                this.nextKey.set(stalePrev, staleNext);
            }
            this.nextKey.set(key, undefined!);
            this.previousKey.set(key, undefined!);
        }
        this.items.set(key, value);

        // Do order bookkeeping
        if (this.firstKey === undefined) {
            this.firstKey = key;
            this.lastKey = key;
        } else if (isNewValue) {
            this.nextKey.set(this.lastKey!, key);
            this.previousKey.set(key, this.lastKey!);
            this.lastKey = key;
        }

        return this;
    }

    public [Symbol.iterator](): IterableIterator<[K, V]> {
        return this.entries();
    }

    public entries(): IterableIterator<[K, V]> {
        const getFirstKey = () => this.firstKey;
        const getCurrentNextKey = () => this.nextKey;
        const capturedNextKey = this.nextKey;
        const { items, keySet } = this;
        let key: K | undefined;
        let started = false;
        return {
            [Symbol.iterator](): IterableIterator<[K, V]> {
                return this;
            },
            next(): IteratorResult<[K, V]> {
                if (!started) {
                    started = true;
                    key = getFirstKey();
                } else {
                    do {
                        key = getCurrentNextKey().get(key!) ?? capturedNextKey.get(key!);
                    } while (key !== undefined && keySet.get(key) !== true);
                }
                return { done: !key, value: [key!, items.get(key!)] as [K, V] };
            },
        };
    }

    public keys(): IterableIterator<K> {
        const getFirstKey = () => this.firstKey;
        const getCurrentNextKey = () => this.nextKey;
        const capturedNextKey = this.nextKey;
        const { keySet } = this;
        let key: K | undefined;
        let started = false;
        return {
            [Symbol.iterator](): IterableIterator<K> {
                return this;
            },
            next(): IteratorResult<K> {
                if (!started) {
                    started = true;
                    key = getFirstKey();
                } else {
                    do {
                        key = getCurrentNextKey().get(key!) ?? capturedNextKey.get(key!);
                    } while (key !== undefined && keySet.get(key) !== true);
                }
                return { done: !key, value: key! };
            },
        };
    }

    public values(): IterableIterator<V> {
        const getFirstKey = () => this.firstKey;
        const getCurrentNextKey = () => this.nextKey;
        const capturedNextKey = this.nextKey;
        const { items, keySet } = this;
        let key: K | undefined;
        let started = false;
        return {
            [Symbol.iterator](): IterableIterator<V> {
                return this;
            },
            next(): IteratorResult<V> {
                if (!started) {
                    started = true;
                    key = getFirstKey();
                } else {
                    do {
                        key = getCurrentNextKey().get(key!) ?? capturedNextKey.get(key!);
                    } while (key !== undefined && keySet.get(key) !== true);
                }
                return { done: !key, value: items.get(key!) };
            },
        };
    }
}
