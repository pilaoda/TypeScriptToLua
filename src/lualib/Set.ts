export class Set<T extends AnyNotNil> {
    public static [Symbol.species] = Set;
    public [Symbol.toStringTag] = "Set";

    public size = 0;

    // Flat array storage (1-based indices for Lua)
    private keyIndex = new LuaTable<T, number>();
    private orderedKeys = new LuaTable<number, T>();
    private nextSlot = 1;

    constructor(values?: Iterable<T> | T[]) {
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
        if (!this.has(value)) {
            this.size++;
            const idx = this.nextSlot;
            this.nextSlot = idx + 1;
            this.keyIndex.set(value, idx);
            this.orderedKeys.set(idx, value);
        }
        return this;
    }

    public clear(): void {
        this.keyIndex = new LuaTable();
        this.orderedKeys = new LuaTable();
        this.nextSlot = 1;
        this.size = 0;
    }

    public delete(value: T): boolean {
        const idx = this.keyIndex.get(value);
        if (idx === undefined) return false;
        this.size--;
        this.keyIndex.set(value, undefined!);
        this.orderedKeys.set(idx, undefined!);
        return true;
    }

    public forEach(callback: (value: T, key: T, set: Set<T>) => any): void {
        for (const key of this.keys()) {
            callback(key, key, this);
        }
    }

    public has(value: T): boolean {
        return this.keyIndex.get(value) !== undefined;
    }

    public [Symbol.iterator](): IterableIterator<T> {
        return this.values();
    }

    public entries(): IterableIterator<[T, T]> {
        const { orderedKeys } = this;
        const getNextSlot = () => this.nextSlot;
        let idx = 0;
        return {
            [Symbol.iterator](): IterableIterator<[T, T]> {
                return this;
            },
            next(): IteratorResult<[T, T]> {
                idx++;
                while (idx < getNextSlot() && orderedKeys.get(idx) === undefined) {
                    idx++;
                }
                if (idx >= getNextSlot()) {
                    return { done: true, value: undefined! };
                }
                const val = orderedKeys.get(idx)!;
                return { done: false, value: [val, val] as [T, T] };
            },
        };
    }

    public keys(): IterableIterator<T> {
        const { orderedKeys } = this;
        const getNextSlot = () => this.nextSlot;
        let idx = 0;
        return {
            [Symbol.iterator](): IterableIterator<T> {
                return this;
            },
            next(): IteratorResult<T> {
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

    public values(): IterableIterator<T> {
        const { orderedKeys } = this;
        const getNextSlot = () => this.nextSlot;
        let idx = 0;
        return {
            [Symbol.iterator](): IterableIterator<T> {
                return this;
            },
            next(): IteratorResult<T> {
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
