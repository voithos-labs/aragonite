/**
 * Table's `caretTargetAtPoint`: the cell a point lands a caret in, as a `[rowIdx, colIdx]` path
 * plus a within-cell offset. NEAREST, not exact — the difference from `tableDragHitTest` beside
 * it. A point clamped into the table's box can sit in a gutter, a padding gap or a windowing
 * spacer and must still land a caret, where an exact `elementFromPoint` hit declines.
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
		// The ABSOLUTE row index: under row windowing the first mounted row is not row 0.
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
	return nearest === null ? null : { path: nearest, offset: CURSOR_END };
}

// Squared: only the ordering is read, and ties keep the first (lowest row, then column).
function squaredDistanceToBox(box: DOMRect, x: number, y: number): number {
	const dx = x < box.left ? box.left - x : x > box.right ? x - box.right : 0;
	const dy = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
	return dx * dx + dy * dy;
}
