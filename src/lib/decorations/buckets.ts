/**
 * Per-run indexes of a merged decoration set, built once when the set changes so each
 * overlay reads only its own bucket instead of scanning every decoration per render.
 */

import type { Decoration, MarkDecoration } from './types';
import { gridCellOf } from '../core/coordinate-spaces';

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

/** Group decorations under every strict ancestor of their own path, so a grid, which paints
 *  its cells' decorations itself, reads one bucket instead of the full list. */
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

/** One whole-cell rect: the union of every mark's class tokens, the last mark (whose attrs the
 *  rect carries), and every mark in the cell, for picking which one answers the pointer. */
export interface CollapsedCellMark {
	rowIdx: number;
	colIdx: number;
	class: string;
	dec: MarkDecoration;
	marks: IndexedDecoration<MarkDecoration>[];
}

/** Collapse a grid's cell marks to one entry per `(row, col)`, unioning class tokens so two
 *  sources in one cell compose instead of stacking translucent rects. */
export function collapseCellMarks(
	descMarks: readonly IndexedDecoration<MarkDecoration>[],
	gridPath: readonly number[]
): CollapsedCellMark[] {
	const byCell = new Map<
		string,
		{
			rowIdx: number;
			colIdx: number;
			classes: Set<string>;
			marks: IndexedDecoration<MarkDecoration>[];
		}
	>();
	for (const mark of descMarks) {
		const at = gridCellOf(gridPath, mark.dec.path);
		if (!at) continue;
		const { row: rowIdx, col: colIdx } = at;
		const cell = byCell.get(`${rowIdx},${colIdx}`);
		if (cell) {
			addClassTokens(cell.classes, mark.dec.class);
			cell.marks.push(mark);
		} else {
			byCell.set(`${rowIdx},${colIdx}`, {
				rowIdx,
				colIdx,
				classes: addClassTokens(new Set(), mark.dec.class),
				marks: [mark]
			});
		}
	}
	return [...byCell.values()].map(({ rowIdx, colIdx, classes, marks }) => ({
		rowIdx,
		colIdx,
		class: [...classes].join(' '),
		dec: marks[marks.length - 1].dec,
		marks
	}));
}

function addClassTokens(set: Set<string>, cls: string): Set<string> {
	for (const token of cls.split(/\s+/)) if (token) set.add(token);
	return set;
}
