/**
 * A bounded, LRU-evicting memo for expensive render work — the cache primitive a plugin
 * renderer builds on (see the plugin guide's renderer recipe). Async needs no variant:
 * the caller stores the Promise, so an in-flight render is shared and a rejection is
 * cached verbatim. `cloneOnRead` covers the one case a bare cache cannot — a value
 * holding a live DOM node, which cannot occupy two places at once.
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
	// Reported at creation, not per read: a non-positive cap would otherwise behave as 1
	// unnoticed, so the author who meant "no caching" gets caching with nothing to read.
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
