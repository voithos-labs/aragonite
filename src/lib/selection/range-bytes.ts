/**
 * A selection read as the bytes the range-edit core takes (`range-edit/edit-range.ts :: Range`):
 * each end's byte in the document, widened to every block the coverage holds whole. Copy, cut and
 * the overlay read a range through here.
 */

import type { DocumentView } from '../core/node-views';
import { displayLength, ownTrailingLineEnding } from '../core/lines';
import { metadataOf } from '../core/nodes';
import { blockNodeAt } from '../tree-operations/node-primitives';
import type { Range } from '../range-edit/edit-range';
import { documentLayout, type LaidBlock, type Layout } from '../range-edit/layout';
import { pathsEqual } from './path-math';
import type { SelectionPoint } from './primitives';
import type { RangeCoverage } from './range-coverage';

/** The range's bytes in `source`, the document's bytes; null for a rectangle of cells inside one
 *  table, which never reaches the core. */
export function rangeBytes(
	doc: DocumentView,
	source: string,
	coverage: RangeCoverage,
	layout: Layout = documentLayout(doc)
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
	// A range across blocks from the first caret position to the last is select-all's, which takes
	// every container's markers with it.
	const edges = !pathsEqual(start.path, end.path) && caretEdges(doc, layout);
	if (edges && from <= edges.first && to >= edges.last) from = 0;
	// No end sits between a line's `\r` and its `\n`.
	const offPair = (at: number) => (source[at - 1] === '\r' && source[at] === '\n' ? at - 1 : at);
	return { from: offPair(from), to: offPair(to) };
}

/** A text end's byte; a cell end's row, from its first byte or to its last; any other block's own
 *  edge on that side, since its offsets address no text. */
function endByte(
	doc: DocumentView,
	layout: Layout,
	point: SelectionPoint,
	side: 'start' | 'end'
): number | null {
	const node = blockNodeAt(doc, point.path);
	if (!node) return null;
	const byte = point.cellCoordinate ? null : layout.byteOf(point.path, point.offset);
	if (byte !== null) return byte;
	const row = point.cellCoordinate
		? Math.floor(point.offset / metadataOf(node, 'table').columnCount)
		: null;
	const block = layout.block(row === null ? point.path : [...point.path, row]);
	if (!block) return null;
	return side === 'start' ? block.from : row === null ? textEnd(doc, block) : block.to;
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

/** Where a block held whole ends: its last line's text; its kind takes the line ending with it. */
const textEnd = (doc: DocumentView, block: LaidBlock) =>
	block.to - ownTrailingLineEnding(blockNodeAt(doc, block.path)!.raw).length;
