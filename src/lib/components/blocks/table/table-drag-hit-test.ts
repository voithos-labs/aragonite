/**
 * Table's `foreignDragHitTest`: translate a foreign drag's viewport point into
 * a row-major cellIdx for the cross-block selection focus. Owns the cellIdx
 * encoding so the selection layer stays free of table-DOM knowledge — it
 * dispatches here via the block-kind descriptor registry.
 */

import { cellAtPoint } from './cell-pointer';

export function tableDragHitTest(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number
): number | null {
	const tableEl = blockEl.querySelector(':scope > [role="table"]') as HTMLElement | null;
	if (!tableEl) return null;

	const cell = cellAtPoint(clientX, clientY, tableEl);
	if (!cell) return null;

	// Read the first MOUNTED row, not row 0 — row-windowing unmounts row 0 once
	// the table scrolls past it (VR-K1). Column tracks are uniform, so any
	// mounted row yields the same count. Mirrors TableBlock.collectColumnRects.
	const firstRow = tableEl.querySelector(':scope > [data-table-row-idx]');
	if (!firstRow) return null;
	const columnCount = firstRow.querySelectorAll(':scope > [role="cell"]').length;
	if (columnCount === 0) return null;

	return cell.rowIdx * columnCount + cell.colIdx;
}
