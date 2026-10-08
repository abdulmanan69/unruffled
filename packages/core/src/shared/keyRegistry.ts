/**
 * Cross-instance serialisation by resource key.
 *
 * The documented failure this closes: a mutation flag that is not set synchronously leaves a
 * window in which a second click is accepted. Disabling a button on a pending flag that
 * arrives a tick later does not help, and neither does disabling it at all when the second
 * trigger comes from a different component that happens to write the same record.
 *
 * So the guard is not a boolean on one hook. It is a registry keyed by resource identity,
 * written synchronously inside the event handler, and shared by every machine that declares
 * the same key. Two buttons in two subtrees that both save customer 42 contend correctly.
 */

/** Returned by a successful acquire. Calling it twice is safe. */
export type ReleaseFn = () => void;

export interface KeyRegistry {
  /**
   * Takes the lock for `key`, or returns `null` when it is already held.
   *
   * Synchronous by contract. The caller must treat `null` as "a duplicate was rejected",
   * not as an error.
   */
  acquire(key: string): ReleaseFn | null;
  /** True when `key` currently has a holder. */
  isHeld(key: string): boolean;
  /** Number of held keys. Used by diagnostics and by tests. */
  size(): number;
  /** Releases everything. Tests call this between cases. */
  clear(): void;
}

export function createKeyRegistry(): KeyRegistry {
  const held = new Set<string>();

  return {
    acquire(key) {
      if (held.has(key)) return null;
      held.add(key);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        held.delete(key);
      };
    },
    isHeld: (key) => held.has(key),
    size: () => held.size,
    clear: () => {
      held.clear();
    },
  };
}

/**
 * The default registry.
 *
 * Module-scoped because the contention it models is genuinely global: two unrelated
 * components writing the same record must contend, and a provider boundary between them is
 * an implementation detail of the tree, not of the resource. A consumer that needs isolation
 * (a test, or two independent embedded apps on one page) passes its own registry.
 */
export const globalKeyRegistry: KeyRegistry = createKeyRegistry();
