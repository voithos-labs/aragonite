/**
 * The block content element at a path: what cross-block caret arithmetic measures against.
 * Table cells carry no `data-block-path` (they render without BlockHost), so a deep cell path
 * resolves the table wrapper and descends into the cell DOM.
 */

import { BLOCK_CONTENT_SELECTOR, TABLE_CELL_SELECTOR } from './block-content-selector';

export function blockContentElAt(root: HTMLElement, path: number[]): HTMLElement | null {
	const wrapper = root.querySelector(`[data-block-path='${JSON.stringify(path)}']`);
	if (wrapper) return wrapper.querySelector(BLOCK_CONTENT_SELECTOR) as HTMLElement | null;
	if (path.length < 3) return null;
	const tablePath = path.slice(0, -2);
	const rowIdx = path[path.length - 2];
	const colIdx = path[path.length - 1];
	const tableWrapper = root.querySelector(`[data-block-path='${JSON.stringify(tablePath)}']`);
	if (!tableWrapper) return null;
	const tableEl = tableWrapper.querySelector(':scope > [role="table"]');
	if (!tableEl) return null;
	const rowEl = tableEl.querySelector(`:scope > [data-table-row-idx='${rowIdx}']`);
	if (!rowEl) return null;
	const cells = rowEl.querySelectorAll(`:scope > ${TABLE_CELL_SELECTOR}`);
	return (cells[colIdx] as HTMLElement | undefined) ?? null;
}
