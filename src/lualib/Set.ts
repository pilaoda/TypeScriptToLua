const NEXT_VERSION = {};

export class Set<T extends AnyNotNil> {
    public static [Symbol.species] = Set;
    public [Symbol.toStringTag] = "Set";

    public size = 0;

    private firstKey: T | undefined;
    private lastKey: T | undefined;
    private nextKey = new LuaTable<T, T>();
    private previousKey = new LuaTable<T, T>();
    private members = new LuaTable<T, true>();
    private deletedCount = 0;

    constructor(values?: Iterable<T> | T[]) {
        setmetatable(this.nextKey, { __mode: "k" });
        setmetatable(this.previousKey, { __mode: "k" });
        if (values === undefined) return;

        const iterable = values as Iterable<T>;
        if (iterable[Symbol.iterator]) {
            // Iterate manually because Set is compiled with ES5 which doesn't support Iterables in for...of
            const iterator = iterable[Symbol.iterator]();
            while (true) {
                const result = iterator.next();
                if (result.done) {
                    break;
                }
                this.add(result.value);
            }
        } else {
            const array = values as T[];
            for (const value of array) {
                this.add(value);
            }
        }
    }

    public add(value: T): Set<T> {
        const isNewValue = !this.has(value);
        if (isNewValue) {
            this.size++;
            this.members.set(value, true);

            // Fix stale forward pointer from predecessor (if re-adding a deleted value)
            const stalePrev = this.previousKey.get(value);
            const staleNext = this.nextKey.get(value);
            if (stalePrev !== undefined && staleNext !== undefined) {
                this.nextKey.set(stalePrev, staleNext);
            }
            this.nextKey.set(value, undefined!);
            this.previousKey.set(value, undefined!);
        }

        // Do order bookkeeping
        if (this.firstKey === undefined) {
            this.firstKey = value;
            this.lastKey = value;
        } else if (isNewValue) {
            this.nextKey.set(this.lastKey!, value);
            this.previousKey.set(value, this.lastKey!);
            this.lastKey = value;
        }

        return this;
    }

    public clear(): void {
        this.nextKey = new LuaTable();
        this.previousKey = new LuaTable();
        this.members = new LuaTable();
        setmetatable(this.nextKey, { __mode: "k" });
        setmetatable(this.previousKey, { __mode: "k" });
        this.firstKey = undefined;
        this.lastKey = undefined;
        this.size = 0;
        this.deletedCount = 0;
    }

    public delete(value: T): boolean {
        const contains = this.has(value);
        if (contains) {
            this.size--;
            this.deletedCount++;
            this.members.delete(value);

            const next = this.nextKey.get(value);
            const previous = this.previousKey.get(value);

            if (value === this.firstKey) {
                let fk = next;
                while (fk !== undefined && this.members.get(fk) !== true) {
                    fk = this.nextKey.get(fk);
                }
                this.firstKey = fk;
            }
            if (value === this.lastKey) {
                let lk = previous;
                while (lk !== undefined && this.members.get(lk) !== true) {
                    lk = this.previousKey.get(lk);
                }
                this.lastKey = lk;
            }

            if (previous !== undefined && next !== undefined) {
                this.nextKey.set(previous, next);
                this.previousKey.set(next, previous);
            }

            if (this.deletedCount > this.size) {
                this.compact();
            }
        }

        return contains;
    }

    private compact(): void {
        const oldNextKey = this.nextKey;
        const newNextKey = new LuaTable<T, T>();
        const newPreviousKey = new LuaTable<T, T>();
        setmetatable(newNextKey, { __mode: "k" });
        setmetatable(newPreviousKey, { __mode: "k" });

        let k = this.firstKey;
        while (k !== undefined) {
            const n = oldNextKey.get(k);
            if (n !== undefined) {
                newNextKey.set(k, n);
                newPreviousKey.set(n, k);
            }
            k = n;
        }

        oldNextKey.set(NEXT_VERSION as any, newNextKey as any);

        this.nextKey = newNextKey;
        this.previousKey = newPreviousKey;
        this.deletedCount = 0;
    }

    public forEach(callback: (value: T, key: T, set: Set<T>) => any): void {
        for (const key of this.keys()) {
            callback(key, key, this);
        }
    }

    public has(value: T): boolean {
        return this.members.get(value) === true;
    }

    public [Symbol.iterator](): IterableIterator<T> {
        return this.values();
    }

    public entries(): IterableIterator<[T, T]> {
        const getFirstKey = () => this.firstKey;
        const { members } = this;
        let table = this.nextKey;
        let key: T | undefined;
        let started = false;
        return {
            [Symbol.iterator](): IterableIterator<[T, T]> {
                return this;
            },
            next(): IteratorResult<[T, T]> {
                let transitioned = false;
                while (table.get(NEXT_VERSION as any) !== undefined) {
                    if (started) {
                        const prevKey = key;
                        while (key !== undefined && members.get(key) !== true) { key = table.get(key!); }
                        if (key !== prevKey) transitioned = true;
                    }
                    table = table.get(NEXT_VERSION as any) as any;
                }
                if (!started) {
                    started = true;
                    key = getFirstKey();
                } else if (!transitioned) {
                    do { key = table.get(key!); } while (key !== undefined && members.get(key) !== true);
                }
                const val = key!;
                return { done: !key, value: [val, val] as [T, T] };
            },
        };
    }

    public keys(): IterableIterator<T> {
        const getFirstKey = () => this.firstKey;
        const { members } = this;
        let table = this.nextKey;
        let key: T | undefined;
        let started = false;
        return {
            [Symbol.iterator](): IterableIterator<T> {
                return this;
            },
            next(): IteratorResult<T> {
                let transitioned = false;
                while (table.get(NEXT_VERSION as any) !== undefined) {
                    if (started) {
                        const prevKey = key;
                        while (key !== undefined && members.get(key) !== true) { key = table.get(key!); }
                        if (key !== prevKey) transitioned = true;
                    }
                    table = table.get(NEXT_VERSION as any) as any;
                }
                if (!started) {
                    started = true;
                    key = getFirstKey();
                } else if (!transitioned) {
                    do { key = table.get(key!); } while (key !== undefined && members.get(key) !== true);
                }
                return { done: !key, value: key! };
            },
        };
    }

    public values(): IterableIterator<T> {
        const getFirstKey = () => this.firstKey;
        const { members } = this;
        let table = this.nextKey;
        let key: T | undefined;
        let started = false;
        return {
            [Symbol.iterator](): IterableIterator<T> {
                return this;
            },
            next(): IteratorResult<T> {
                let transitioned = false;
                while (table.get(NEXT_VERSION as any) !== undefined) {
                    if (started) {
                        const prevKey = key;
                        while (key !== undefined && members.get(key) !== true) { key = table.get(key!); }
                        if (key !== prevKey) transitioned = true;
                    }
                    table = table.get(NEXT_VERSION as any) as any;
                }
                if (!started) {
                    started = true;
                    key = getFirstKey();
                } else if (!transitioned) {
                    do { key = table.get(key!); } while (key !== undefined && members.get(key) !== true);
                }
                return { done: !key, value: key! };
            },
        };
    }

    /**
     * @returns a new Set containing all the elements in this Set and also all the elements in the argument.
     */
    public union(other: ReadonlySet<T>): Set<T> {
        const result = new Set<T>(this);
        for (const item of other) {
            result.add(item);
        }
        return result;
    }

    /**
     * @returns a new Set containing all the elements which are both in this Set and in the argument.
     */
    public intersection(other: ReadonlySet<T>) {
        const result = new Set<T>();
        for (const item of this) {
            if (other.has(item)) {
                result.add(item);
            }
        }
        return result;
    }

    /**
     * @returns a new Set containing all the elements in this Set which are not also in the argument.
     */
    public difference(other: ReadonlySet<T>): Set<T> {
        const result = new Set<T>(this);
        for (const item of other) {
            result.delete(item);
        }
        return result;
    }

    /**
     * @returns a new Set containing all the elements which are in either this Set or in the argument, but not in both.
     */
    public symmetricDifference(other: ReadonlySet<T>): Set<T> {
        const result = new Set<T>(this);
        for (const item of other) {
            if (this.has(item)) {
                result.delete(item);
            } else {
                result.add(item);
            }
        }
        return result;
    }

    /**
     * @returns a boolean indicating whether all the elements in this Set are also in the argument.
     */
    public isSubsetOf(other: ReadonlySet<unknown>): boolean {
        for (const item of this) {
            if (!other.has(item)) {
                return false;
            }
        }
        return true;
    }

    /**
     * @returns a boolean indicating whether all the elements in the argument are also in this Set.
     */
    public isSupersetOf(other: ReadonlySet<unknown>): boolean {
        for (const item of other) {
            if (!this.has(item as T)) {
                return false;
            }
        }
        return true;
    }

    /**
     * @returns a boolean indicating whether this Set has no elements in common with the argument.
     */
    public isDisjointFrom(other: ReadonlySetLike<unknown>): boolean {
        for (const item of this) {
            if (other.has(item)) {
                return false;
            }
        }
        return true;
    }
}
