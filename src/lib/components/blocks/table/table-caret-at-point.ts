/**
 * Table's `caretTargetAtPoint`: the cell a point lands a caret in, as a
 * `[rowIdx, colIdx]` path plus a within-cell offset. Its one consumer is the
 * dead-space click, which has no character position to aim at — the table's
 * block-level offset is a row-major cellIdx, so "the end of that line" names a
 * cell and the gesture needs the kind to say which.
 *
 * NEAREST, not exact, which is the whole difference from `tableDragHitTest` beside
 * it: the point arrives already clamped into the table's box, so it can sit in the
 * row-grip gutter, in a padding gap, or in a windowing spacer band, and a caret
 * gesture still has to land somewhere. One 2D box-distance scan answers all of
 * those with one rule — an exact `elementFromPoint` hit, which is what a drag
 * needs so a pointer crossing a gutter holds its focus, would decline them.
 *
 * Only MOUNTED rows are measured (rows are `display: contents`, so a cell's box is
 * the row's), which is also the only slice a click can be over.
 */

import { CURSOR_END } from '../../../block-component';
import { mountedRowEls, rowCellEls } from './cell-pointer';

export function tableCaretAtPoint(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number
): { path: number[]; offset: number } | null {
	const tableEl = blockEl.querySelector(':scope > [role="table"]') as HTMLElement | null;
	if (!tableEl) return null;

	let nearest: number[] | null = null;
	let smallestDistance = Infinity;
	for (const rowEl of mountedRowEls(tableEl)) {
		// The ABSOLUTE row index, not the mounted position — under row windowing the
		// first mounted row is not row 0.
		const rowIdx = Number(rowEl.getAttribute('data-table-row-idx'));
		if (Number.isNaN(rowIdx)) continue;
		rowCellEls(rowEl).forEach((cell, colIdx) => {
			const distance = squaredDistanceToBox(cell.getBoundingClientRect(), clientX, clientY);
			if (distance < smallestDistance) {
				smallestDistance = distance;
				nearest = [rowIdx, colIdx];
			}
		});
	}
	// A grid with no mounted cell has no coordinate to name; the caller declines.
	return nearest === null ? null : { path: nearest, offset: CURSOR_END };
}

// Squared, because only the ordering is read — no square root, and equal boxes
// keep the first (lowest row, then lowest column) scanned.
function squaredDistanceToBox(box: DOMRect, x: number, y: number): number {
	const dx = x < box.left ? box.left - x : x > box.right ? x - box.right : 0;
	const dy = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
	return dx * dx + dy * dy;
}
