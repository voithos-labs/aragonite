/**
 * Table's `caretTargetAtPoint`: the cell a point puts a caret in, as a `[rowIdx, colIdx]` path
 * plus the cell's offset nearest the point, so a point left of a cell lands before its text.
 * Nearest, not exact, which is the difference from `tableDragHitTest` beside it: a point in a
 * gutter, a padding gap or a windowing spacer must still land a caret.
 */

import { CURSOR_END } from '../../../block-component';
import type { CaretTarget } from '../../../schema/block-kind-descriptor';
import { caretOffsetAtPoint } from '../../../browser/point';
import { mountedRowEls, rowCellEls } from './cell-pointer';

export function tableCaretAtPoint(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number
): CaretTarget | null {
	const tableEl = blockEl.querySelector(':scope > [role="table"]') as HTMLElement | null;
	if (!tableEl) return null;

	let nearest: { path: number[]; cell: HTMLElement } | null = null;
	let smallestDistance = Infinity;
	for (const rowEl of mountedRowEls(tableEl)) {
		// The absolute row index: under row windowing the first mounted row is not row 0.
		const rowIdx = Number(rowEl.getAttribute('data-table-row-idx'));
		if (Number.isNaN(rowIdx)) continue;
		for (const [colIdx, cell] of rowCellEls(rowEl).entries()) {
			const distance = squaredDistanceToBox(cell.getBoundingClientRect(), clientX, clientY);
			if (distance < smallestDistance) {
				smallestDistance = distance;
				nearest = { path: [rowIdx, colIdx], cell };
			}
		}
	}
	if (nearest === null) return null;
	const { path, cell } = nearest;
	// An empty cell holds no text to measure, and its end is its only offset.
	return { path, offset: caretOffsetAtPoint(cell, clientX, clientY) ?? CURSOR_END };
}

// Squared: only the ordering is read, and ties keep the first (lowest row, then column).
function squaredDistanceToBox(box: DOMRect, x: number, y: number): number {
	const dx = x < box.left ? box.left - x : x > box.right ? x - box.right : 0;
	const dy = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
	return dx * dx + dy * dy;
}
