/**
 * Per-run indexes of a merged decoration set — by owning leaf path, and by
 * ancestor prefix for grid surfaces. Built once when the set changes so each
 * overlay reads only its own bucket instead of scanning every decoration on
 * every render.
 */

import type { Decoration } from './types';

/** A decoration paired with its position in the flat merged list — the stable
 *  key overlays render against. */
export interface IndexedDecoration<D extends Decoration = Decoration> {
	dec: D;
	index: number;
}

/** Stable string key for a block path. Distinct paths never collide: elements
 *  are numbers joined by a separator that can't appear within one. */
export function pathKey(path: readonly number[]): string {
	return path.join(',');
}

/** Group decorations by owning leaf path, preserving each one's flat index. */
export function groupDecorationsByPath(
	decs: readonly Decoration[]
): Map<string, IndexedDecoration[]> {
	const byPath = new Map<string, IndexedDecoration[]>();
	decs.forEach((dec, index) => {
		push(byPath, pathKey(dec.path), dec, index);
	});
	return byPath;
}

/**
 * Group decorations under every strict ancestor prefix of their owning path (the
 * root prefix excluded — that bucket would be the whole list). Grid surfaces
 * (table) paint descendant cell decorations themselves because cells have no
 * BlockHost overlay; this lets them read one bucket instead of scanning the full
 * list.
 */
export function groupDecorationsByAncestor(
	decs: readonly Decoration[]
): Map<string, IndexedDecoration[]> {
	const byAncestor = new Map<string, IndexedDecoration[]>();
	decs.forEach((dec, index) => {
		for (let len = 1; len < dec.path.length; len++) {
			push(byAncestor, pathKey(dec.path.slice(0, len)), dec, index);
		}
	});
	return byAncestor;
}

function push(
	map: Map<string, IndexedDecoration[]>,
	key: string,
	dec: Decoration,
	index: number
): void {
	const bucket = map.get(key);
	if (bucket) bucket.push({ dec, index });
	else map.set(key, [{ dec, index }]);
}
