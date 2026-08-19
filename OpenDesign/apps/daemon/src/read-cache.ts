// In-memory cache for expensive read-only listings.
//
// The listing endpoints (design systems, skills, prompt templates) each walk a
// directory tree and read every file in it. That is cheap on a local SSD and
// prohibitive when the repo is served from a network share, where every one of
// those hundreds of calls is a round trip: `/api/design-systems` measured 21.8s
// and `/api/skills` 5.4s on this deployment. No amount of concurrency tuning
// gets a few hundred round trips under a 300ms budget — the only way there is
// to not touch the disk at all on the common path.
//
// Correctness comes from invalidating aggressively rather than from guessing a
// TTL. Entries live until ANY mutating /api request arrives (see the middleware
// in server.ts), at which point the whole cache is dropped. That is deliberately
// blunt: it is impossible for a write to leave a stale read behind, and the cost
// of over-invalidating is one slow re-read, which is exactly what every request
// used to cost.
//
// Promises are cached, not values, so N concurrent requests for the same key
// share ONE directory walk instead of starting N of them — the stampede that
// made the first page load after a restart so much worse than a warm one.

interface CacheEntry {
  generation: number;
  value: Promise<unknown>;
}

const entries = new Map<string, CacheEntry>();

// Generation counters are PER KEY, not global. A single shared counter looked
// simpler but silently defeated targeted invalidation: bumping it invalidated
// every entry regardless of which keys were named, so a project write still
// dropped the expensive skills walk. Each key advances only when something
// actually invalidates it. An in-flight load that began before its key was
// invalidated may have read pre-write state, so it is discarded rather than
// stored — the resolver compares the generation it started under.
const generations = new Map<string, number>();

function generationOf(key: string): number {
  return generations.get(key) ?? 0;
}

export function cachedRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = entries.get(key);
  const generation = generationOf(key);
  if (hit && hit.generation === generation) return hit.value as Promise<T>;

  const startedAt = generation;
  const value = (async () => {
    try {
      return await load();
    } catch (err) {
      // Never cache a failure: a transient fs error would otherwise pin an
      // endpoint into permanent failure until the next write. Matching on the
      // generation rather than on this promise keeps the check self-contained;
      // an equal generation means no invalidation has happened since, so the
      // entry is ours (or an identical retry) and dropping it is safe.
      const current = entries.get(key);
      if (current && current.generation === startedAt) entries.delete(key);
      throw err;
    }
  })();

  entries.set(key, { generation: startedAt, value });
  return value;
}

/**
 * Drop cached listings. Pass the keys a write can actually affect; omit to drop
 * everything. Targeting matters because the invalidating writes are not rare —
 * starting a run creates a project — and a blanket clear would throw away the
 * multi-second `skills:all` walk every time someone begins a clone.
 *
 * The generation still advances for a partial invalidation: an in-flight load
 * of an untouched key is then re-run rather than stored, which costs one repeat
 * read and removes any question of a load that straddles a write being kept.
 */
export function invalidateReadCache(keys?: readonly string[]): void {
  const targets = keys ?? [...new Set([...entries.keys(), ...generations.keys()])];
  for (const key of targets) {
    generations.set(key, generationOf(key) + 1);
    entries.delete(key);
  }
}

/** Test seam. */
export function readCacheSize(): number {
  return entries.size;
}
