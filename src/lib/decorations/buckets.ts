/**
 * Per-run indexes of a merged decoration set, built once when the set changes so each
 * overlay reads only its own bucket instead of scanning every decoration per render.
 */

import type { Decoration, MarkDecoration } from './types';

/** A decoration paired with its flat-list position — the stable key overlays render against. */
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

/**
 * Group decorations under every strict ancestor prefix of their owning path. Grid
 * surfaces paint descendant cell decorations themselves, cells having no BlockHost
 * overlay, so this lets them read one bucket instead of the full list.
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

// ── Grid cell collapse ─────────────────────────────────────────────────────

/** One whole-cell rect: the union of every mark's class tokens, plus a representative
 *  decoration for the rect's attrs/interactive. */
export interface CollapsedCellMark {
	rowIdx: number;
	colIdx: number;
	class: string;
	dec: MarkDecoration;
}

/**
 * Collapse a grid's descendant cell marks to one entry per `(row, col)`, unioning their
 * class tokens so two sources in one cell cascade-compose instead of stacking translucent
 * rects. `containerDepth` is the grid container's path length; the cell coordinates sit at
 * `path[depth]` and `path[depth + 1]`.
 */
export function collapseCellMarks(
	descMarks: readonly IndexedDecoration<MarkDecoration>[],
	containerDepth: number
): CollapsedCellMark[] {
	const byCell = new Map<
		string,
		{ rowIdx: number; colIdx: number; classes: Set<string>; dec: MarkDecoration }
	>();
	for (const { dec } of descMarks) {
		const rowIdx = dec.path[containerDepth];
		const colIdx = dec.path[containerDepth + 1];
		if (rowIdx == null || colIdx == null) continue;
		const cell = byCell.get(`${rowIdx},${colIdx}`);
		if (cell) {
			addClassTokens(cell.classes, dec.class);
			cell.dec = dec;
		} else {
			byCell.set(`${rowIdx},${colIdx}`, {
				rowIdx,
				colIdx,
				classes: addClassTokens(new Set(), dec.class),
				dec
			});
		}
	}
	return [...byCell.values()].map(({ rowIdx, colIdx, classes, dec }) => ({
		rowIdx,
		colIdx,
		class: [...classes].join(' '),
		dec
	}));
}

function addClassTokens(set: Set<string>, cls: string): Set<string> {
	for (const token of cls.split(/\s+/)) if (token) set.add(token);
	return set;
}
