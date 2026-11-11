/**
 * A selection read as the bytes the range-edit core takes (`range-edit/edit-range.ts :: Range`):
 * each end's byte in the document, widened to every block the coverage holds whole and kept off a
 * block its start can't join. Copy, cut and the overlay read a range through here.
 */

import { untrack } from 'svelte';
import type { DocumentView } from '../core/node-views';
import { displayLength, ownTrailingLineEnding } from '../core/lines';
import { metadataOf } from '../core/nodes';
import { docPathFrom, type DocPath } from '../core/coordinate-spaces';
import { countsCells } from '../schema/block-kind-descriptor';
import { isMergeEligible } from '../schema/merge-rules';
import { blockNodeAt } from '../tree-operations/node-primitives';
import { documentByteMap, leafAtByte } from '../tree-operations/container-offsets';
import type { Measured } from '../tree-operations/top-level-starts';
import { gapEligibleAt, type GapCaretPosition } from './gap-caret';
import type { Range } from '../range-edit/edit-range';
import { documentLayout, type LaidBlock, type Layout } from '../range-edit/layout';
import { pathsEqual } from './path-math';
import { previousCaretPath } from './path-lookup';
import type { SelectionPoint } from './primitives';
import type { RangeCoverage } from './range-coverage';

/** The editor's document as a range edit reads it: its tree, its bytes and their layout. */
export interface DocumentBytes {
	doc(): DocumentView;
	source(): string;
	layout(): Layout;
	/** The document with the starts of its top-level blocks, kept across writes. */
	measured(): Measured;
}

/** The layout is made once per measured document, which every byte writer's announcement
 *  replaces (G1.52); `version` is read so a reactive caller follows the announcements. */
export function documentBytes(deps: {
	version(): number;
	doc(): DocumentView;
	source(): string;
	measured(): Measured;
}): DocumentBytes {
	let laid: { of: Measured; layout: Layout } | undefined;
	return {
		doc: deps.doc,
		source: deps.source,
		measured: deps.measured,
		layout() {
			deps.version();
			const of = deps.measured();
			if (laid?.of !== of) laid = { of, layout: documentLayout(of) };
			return laid.layout;
		}
	};
}

/** The range's bytes; null for a rectangle of cells inside one table, which never reaches the core. */
export function rangeBytes(
	doc: DocumentView,
	coverage: RangeCoverage,
	layout: Layout
): Range | null {
	if (coverage.grid) return null;
	const { start, end } = coverage.range;
	let from = endByte(doc, layout, start, 'start');
	let to = endByte(doc, layout, end, 'end');
	if (from === null || to === null) return null;
	for (const root of coverage.wholeRoots) {
		const block = layout.block(root);
		if (!block) return null;
		from = Math.min(from, block.from);
		to = Math.max(to, textEnd(doc, block));
	}
	to = Math.max(from, endBesideText(doc, layout, coverage, to));
	// A range across blocks from the first caret position to the last is select-all's, which takes
	// every container's markers with it.
	const edges = !pathsEqual(start.path, end.path) && caretEdges(doc, layout);
	if (edges && from <= edges.first && to >= edges.last) from = 0;
	return { from, to };
}

/** The bytes a removal takes: the range's, or a table whose every cell the range holds. */
export function removalBytes(
	doc: DocumentView,
	coverage: RangeCoverage,
	layout: Layout
): Range | null {
	if (coverage.grid?.kind !== 'table') return rangeBytes(doc, coverage, layout);
	return wholeBlockBytes(doc, layout, coverage.grid.path);
}

/** The bytes of the block at `path` taken whole: its first byte to its last line's text. */
export function wholeBlockBytes(
	doc: DocumentView,
	layout: Layout,
	path: readonly number[]
): Range | null {
	const block = layout.block(path);
	return block ? { from: block.from, to: textEnd(doc, block) } : null;
}

/** The selection point naming byte `at`: the text block holding it and the offset there. */
export function pointAtByte(measured: Measured, at: number): SelectionPoint | null {
	const leaf = leafAtByte(measured, at);
	return leaf && { path: leaf.path.slice(), offset: leaf.offset };
}

/** How a range across blocks paints: one box over each block whose bytes lie inside the range's
 *  while its parent's don't. A table's rows paint through its cells, never as boxes, and a range
 *  inside one block boxes only a unit it holds whole. */
export interface RangePaint {
	readonly coverage: RangeCoverage;
	/** The block holding `path`, itself included, that paints as one box; null for none. */
	boxHolding(path: readonly number[]): DocPath | null;
}

/** Reads nothing until asked, and untracked: a caller makes a new paint for each coverage and
 *  content version. */
export function rangePaint(doc: DocumentView, coverage: RangeCoverage, layout: Layout): RangePaint {
	const { start, end } = coverage.range;
	let range: Range | null | undefined;
	const boxHolding = (path: readonly number[]): DocPath | null => {
		if (range === undefined) {
			range = pathsEqual(start.path, end.path) ? null : rangeBytes(doc, coverage, layout);
		}
		if (!range) return coverage.rootHolding(path);
		for (let depth = 1; depth <= path.length; depth++) {
			const block = layout.block(path.slice(0, depth));
			if (!block) return null;
			if (range.from <= block.from && textEnd(doc, block) <= range.to)
				return docPathFrom(block.path);
			if (countsCells(blockNodeAt(doc, block.path)!)) return null;
		}
		return null;
	};
	return { coverage, boxHolding: (path) => untrack(() => boxHolding(path)) };
}

// ── Internal ────────────────────────────────────────────────────────────────

/** Where a block's own bytes end: its last line's text, since its line ending reads as the next
 *  line's edge. */
const textEnd = (doc: DocumentView, block: LaidBlock) =>
	block.to - ownTrailingLineEnding(blockNodeAt(doc, block.path)!.raw).length;

/** A text end's byte; a cell end's row, or its whole table where the range enters by the first row
 *  or leaves by the last; any other block's own edge, since its offsets address no text. */
function endByte(
	doc: DocumentView,
	layout: Layout,
	point: SelectionPoint,
	side: 'start' | 'end'
): number | null {
	const node = blockNodeAt(doc, point.path);
	if (!node) return null;
	// No end sits between a line's `\r` and its `\n`.
	const { raw } = node;
	const offset =
		raw[point.offset - 1] === '\r' && raw[point.offset] === '\n' ? point.offset - 1 : point.offset;
	const byte = point.cellCoordinate ? null : layout.byteOf(point.path, offset);
	if (byte !== null) return byte;
	const row = point.cellCoordinate
		? Math.floor(point.offset / metadataOf(node, 'table').columnCount)
		: null;
	const whole = row !== null && row === (side === 'end' ? 0 : (node.children?.length ?? 0) - 1);
	const block = layout.block(row === null || whole ? point.path : [...point.path, row]);
	if (!block) return null;
	return side === 'start' ? block.from : row === null || whole ? textEnd(doc, block) : block.to;
}

/** An end on the first byte of a block the start's block can't join moves back to the text before
 *  that block, so the range takes neither the block nor the blank lines that keep it apart. */
function endBesideText(
	doc: DocumentView,
	layout: Layout,
	coverage: RangeCoverage,
	to: number
): number {
	const { start, end } = coverage.range;
	if (start.cellCoordinate || end.cellCoordinate || layout.block(end.path)?.from !== to) return to;
	const startKind = blockNodeAt(doc, start.path)?.kind;
	const endKind = blockNodeAt(doc, end.path)?.kind;
	if (!startKind || !endKind || isMergeEligible(startKind, endKind)) return to;
	const before = previousCaretPath(doc, end.path);
	if (!before) return to;
	// A cell's text ends where its table does.
	const table = before.findIndex((_, i) => countsCells(blockNodeAt(doc, before.slice(0, i + 1))!));
	if (table < 0) return layout.byteOf(before, displayLength(blockNodeAt(doc, before)!.raw)) ?? to;
	const block = layout.block(before.slice(0, table + 1));
	return block ? textEnd(doc, block) : to;
}

/** The document's first and last caret positions, as bytes. */
function caretEdges(doc: DocumentView, layout: Layout): { first: number; last: number } | null {
	const firstPath = edgeLeaf(doc, 0);
	const lastPath = edgeLeaf(doc, -1);
	if (!firstPath || !lastPath) return null;
	const first = layout.byteOf(firstPath, 0);
	const last = layout.byteOf(lastPath, displayLength(blockNodeAt(doc, lastPath)!.raw));
	return first === null || last === null ? null : { first, last };
}

/** The first or last block with no children, outermost path first. */
function edgeLeaf(doc: DocumentView, at: 0 | -1): number[] | null {
	const path: number[] = [];
	let children = doc.children;
	while (children.length > 0) {
		path.push(at === 0 ? 0 : children.length - 1);
		children = children.at(at)!.children ?? [];
	}
	return path.length > 0 ? path : null;
}

/** The byte a gap caret stands at: where the block after it starts, or where its container ends. */
export function byteOfGap(
	measured: Measured,
	{ parentPath, index }: GapCaretPosition
): number | null {
	const { doc, starts } = measured;
	const parent = parentPath.length === 0 ? doc : blockNodeAt(doc, parentPath);
	if (!parent?.children) return null;
	const map = documentByteMap(measured);
	if (index < parent.children.length) return map.byteOf([...parentPath, index], 0);
	if (parentPath.length === 0) return starts.length;
	return map.endOf(parentPath, (parent as { raw: string }).raw.length);
}

/** The deepest boundary a gap caret may take where a block starts, or a container ends, at byte
 *  `at`; null where none may. */
export function gapAtByte(measured: Measured, at: number): GapCaretPosition | null {
	const { doc, starts } = measured;
	const map = documentByteMap(measured);
	let found: GapCaretPosition | null = null;
	let parentPath: number[] = [];
	let children = doc.children;
	const startOf = (k: number) => map.byteOf([...parentPath, k], 0)!;
	// A child starting at or past `at`, or holding it; inside a container, the map's answer alone.
	let near = 0;
	for (let past = children.length; near < past;) {
		const mid = (near + past) >> 1;
		if (startOf(mid) >= at) past = mid;
		else near = mid + 1;
	}
	if (near === children.length) near = children.length - 1;
	let end = starts.length;
	// Where the container the walk is in reads `at`: the child it goes to and the offset there.
	let held: { index: number; offset: number } | null = null;
	for (;;) {
		const index = at === end ? children.length : startOf(near) === at ? near : -1;
		if (index >= 0 && gapEligibleAt(doc, parentPath, index)) found = { parentPath, index };
		// The last child starting at or before `at`.
		let i = near;
		while (i + 1 < children.length && startOf(i + 1) <= at) i++;
		if (i > 0 && startOf(i) > at) i--;
		const child = children[i];
		const inner = child?.children?.length ? map.containerMap(child) : null;
		if (!inner) return found;
		// `at` in the child's raw: a top-level block's raw is its bytes, and a byte the container
		// gave a later child lies past this one's end.
		let offset = at - startOf(i);
		if (held) offset = i === held.index ? held.offset : i < held.index ? child.raw.length : 0;
		parentPath = [...parentPath, i];
		end = map.endOf(parentPath, child.raw.length)!;
		children = child.children!;
		held = inner.childAt(offset);
		near = held.index;
	}
}
