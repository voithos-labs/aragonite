/**
 * Per-run indexes of a merged decoration set, built once when the set changes so each
 * overlay reads only its own bucket instead of scanning every decoration per render.
 */

import type { Decoration } from './types';

/** A decoration paired with its position in the flat list: the stable key overlays render
 *  against. */
export interface IndexedDecoration<D extends Decoration = Decoration> {
	dec: D;
	index: number;
}

/** Stable key for a block path; distinct paths never collide, elements being numbers. */
export function pathKey(path: readonly number[]): string {
	return path.join(',');
}

/** Bucket `{ path }`-bearing items by block path, preserving flat order. Shared by
 *  decorations and search. */
export function groupByPathKey<T extends { path: readonly number[] }, E>(
	items: readonly T[],
	wrap: (item: T, index: number) => E
): Map<string, E[]> {
	const buckets = new Map<string, E[]>();
	items.forEach((item, index) => {
		const key = pathKey(item.path);
		const bucket = buckets.get(key);
		if (bucket) bucket.push(wrap(item, index));
		else buckets.set(key, [wrap(item, index)]);
	});
	return buckets;
}

/** Group decorations by owning leaf path, preserving each one's flat index. */
export function groupDecorationsByPath(
	decs: readonly Decoration[]
): Map<string, IndexedDecoration[]> {
	return groupByPathKey(decs, (dec, index) => ({ dec, index }));
}
