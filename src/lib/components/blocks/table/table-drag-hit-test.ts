/**
 * Table's `foreignDragHitTest`: a foreign drag's viewport point → a row-major cellIdx.
 * Owns the encoding so the selection layer stays free of table-DOM knowledge.
 */

import { cellAtPoint, mountedRowEls, rowCellEls } from './cell-pointer';

export function tableDragHitTest(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number
): number | null {
	const tableEl = blockEl.querySelector(':scope > [role="table"]') as HTMLElement | null;
	if (!tableEl) return null;

	const cell = cellAtPoint(clientX, clientY, tableEl);
	if (!cell) return null;

	const firstRow = mountedRowEls(tableEl)[0];
	if (!firstRow) return null;
	const columnCount = rowCellEls(firstRow).length;
	if (columnCount === 0) return null;

	return cell.rowIdx * columnCount + cell.colIdx;
}
