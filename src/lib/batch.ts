/**
 * Turning many one-at-a-time asks into one request.
 *
 * A list of faces is a list of components, and each one only knows about its
 * own photograph - so each one asks for its own, and a page of four hundred
 * people asks four hundred times. Every one of those is a round trip on a
 * phone on church hall wifi. The component is not wrong to ask that way; it is
 * the only thing it can sensibly know.
 *
 * So the asks are collected instead. Everything requested before the end of
 * the current tick goes out as one call, waiters on the same key share a
 * single answer, and a key already in flight is not asked for twice.
 */

type Waiter<V> = (value: V | undefined) => void;

export interface Batcher<K, V> {
  /** Ask for one key. Resolves when the batch it lands in comes back. */
  get(key: K): Promise<V | undefined>;
  /**
   * Abandons everything queued and everything in flight, answering every
   * waiter with undefined. Used at sign-out, where the answers on their way
   * back are exactly what must not arrive.
   */
  reset(): void;
}

export function createBatcher<K, V>(
  run: (keys: K[]) => Promise<Map<K, V>>,
  /** Largest single request. Bigger batches are split, and all of them fly at once. */
  limit = 100,
): Batcher<K, V> {
  let queued = new Map<K, Waiter<V>[]>();
  /** Keys sent and not yet answered, so a second ask joins the first. */
  const inFlight = new Map<K, Promise<V | undefined>>();
  /** Waiters whose request has gone out, so reset can still let them go. */
  let sent = new Map<K, Waiter<V>[]>();
  let scheduled = false;
  /** Bumped by reset, so answers to abandoned questions are not delivered. */
  let generation = 0;

  function deliver(batch: Map<K, Waiter<V>[]>, results: Map<K, V> | null): void {
    for (const [key, waiters] of batch) {
      inFlight.delete(key);
      sent.delete(key);
      const value = results?.get(key);
      for (const waiter of waiters) waiter(value);
    }
  }

  function flush(): void {
    scheduled = false;
    const batch = queued;
    queued = new Map();
    if (!batch.size) return;

    const era = generation;
    const keys = [...batch.keys()];
    for (const [key, waiters] of batch) sent.set(key, waiters);

    // One promise per chunk, all started together: the point is to stop making
    // four hundred requests, not to make four of them one after another.
    const chunks: K[][] = [];
    for (let at = 0; at < keys.length; at += limit) chunks.push(keys.slice(at, at + limit));

    const pending = Promise.all(chunks.map((chunk) => run(chunk).catch(() => new Map<K, V>())))
      .then((maps) => {
        const merged = new Map<K, V>();
        for (const map of maps) for (const [key, value] of map) merged.set(key, value);
        return merged;
      })
      // A failure is an absent photograph, not a broken page: every waiter is
      // answered either way, or a face would spin for ever.
      .catch(() => new Map<K, V>());

    void pending.then((results) => {
      // Reset has already answered these and moved on; delivering now would
      // hand out links the session is no longer entitled to.
      if (era !== generation) return;
      deliver(batch, results);
    });

    for (const key of keys) {
      inFlight.set(
        key,
        pending.then((results) => (era === generation ? results.get(key) : undefined)),
      );
    }
  }

  return {
    get(key) {
      const already = inFlight.get(key);
      if (already) return already;

      return new Promise<V | undefined>((resolve) => {
        const waiters = queued.get(key);
        if (waiters) waiters.push(resolve);
        else queued.set(key, [resolve]);

        if (!scheduled) {
          scheduled = true;
          // A microtask, so everything a single render asked for goes together
          // and nothing waits on a timer it did not need.
          queueMicrotask(flush);
        }
      });
    },

    reset() {
      generation += 1;
      const dropped = [...queued.values(), ...sent.values()];
      queued = new Map();
      sent = new Map();
      inFlight.clear();
      for (const waiters of dropped) for (const waiter of waiters) waiter(undefined);
    },
  };
}
