/**
 * A bounded, LRU-evicting memo for expensive render work — the cache primitive
 * a plugin renderer builds on instead of hand-rolling one (see the plugin guide's
 * renderer recipe). Sync and async are one primitive: the async caller stores a
 * Promise as the value, so an in-flight render is shared and a rejection is cached
 * verbatim (same key, same failure) — no separate async variant needed.
 *
 * `cloneOnRead` covers the one case a bare cache cannot: a single DOM node cannot
 * occupy two places, so a caller whose value holds a live node clones it on every
 * read while the cached entry stays pristine.
 *
 * Bounded because a render surface commonly mints a fresh key per keystroke, so an
 * unbounded map is a leak. Map iteration is insertion-ordered — re-inserting on a
 * hit makes the first key the least recently used.
 */

import { devWarn } from './dev-warn';

export interface BoundedMemoOptions<V> {
	/** Maximum live entries; the least-recently-used is evicted past it. */
	cap: number;
	/** Return a per-caller copy of a cached value (e.g. clone a live DOM node). */
	cloneOnRead?: (value: V) => V;
}

export function createBoundedMemo<K, V>(
	options: BoundedMemoOptions<V>
): (key: K, compute: () => V) => V {
	const { cloneOnRead } = options;
	// Reported at creation, not per read: a non-positive cap already behaved as 1
	// (evict-then-insert), so the author who meant "no caching" got caching anyway
	// with nothing to read in the console.
	if (options.cap < 1) {
		devWarn('bounded-memo', `cap must be at least 1; got ${options.cap} — using 1`);
	}
	const cap = Math.max(1, options.cap);
	const cache = new Map<K, V>();

	return (key, compute) => {
		let entry: V;
		if (cache.has(key)) {
			entry = cache.get(key)!;
			cache.delete(key); // re-insert below so the hit becomes most recent
		} else {
			entry = compute();
			if (cache.size >= cap) cache.delete(cache.keys().next().value as K);
		}
		cache.set(key, entry);
		return cloneOnRead ? cloneOnRead(entry) : entry;
	};
}
