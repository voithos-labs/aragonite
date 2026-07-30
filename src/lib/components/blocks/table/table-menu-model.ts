/**
 * Pure model for the table affordance menu: which items a target cell, row, or
 * column offers and whether each is enabled. The component renders this and
 * dispatches `context[action](arg)` on click; enablement reuses the context's
 * own refusal predicates so a disabled item can never reach a no-op commit.
 */
import type { TableAxisAction } from '../../../action-contracts';
import type { TableAlignment } from '../../../core/nodes';
import {
	tableRowReorderTarget,
	tableColumnReorderTarget
} from '../../../editor-actions/table-context';
import { canDeleteRow, canDeleteColumn } from '../../../tree-operations/table-mutations';

export type ClipboardAction = 'cut' | 'copy' | 'paste';

/**
 * Clamp a fixed-position menu's desired top-left so the whole menu stays within
 * the viewport (minus `margin`). Menus open at a raw pointer/grip coordinate;
 * near the right/bottom edge part of the menu would otherwise render off-screen
 * and unreachable. A menu larger than the viewport pins to the top/left margin.
 */
export function clampMenuToViewport(
	desired: { x: number; y: number },
	menu: { width: number; height: number },
	viewport: { width: number; height: number },
	margin = 8
): { x: number; y: number } {
	const maxX = Math.max(margin, viewport.width - menu.width - margin);
	const maxY = Math.max(margin, viewport.height - menu.height - margin);
	return {
		x: Math.min(Math.max(margin, desired.x), maxX),
		y: Math.min(Math.max(margin, desired.y), maxY)
	};
}

export type TableMenuItem =
	// `index` is the action's own axis index (rowIdx for row-group actions, colIdx
	// for column-group actions), so a both-axes cell menu can route each item to the
	// right coordinate without the dispatcher tracking which group it came from.
	| { kind: 'action'; action: TableAxisAction; label: string; enabled: boolean; index: number }
	| { kind: 'clipboard'; action: ClipboardAction; label: string; enabled: boolean }
	| { kind: 'alignment'; current: TableAlignment }
	| { kind: 'separator' };

export function tableMenuItems(
	target: { rowIdx?: number; colIdx?: number },
	dims: { rowCount: number; colCount: number },
	alignments: readonly TableAlignment[],
	// Present only for a cell right-click (both axes); drives the clipboard group,
	// which grip menus never show. `hasRect` is a live intra-table rectangle, which
	// suppresses the cell-local selection but is exactly what Cut/Copy serve.
	clipboard?: { hasSelection: boolean; hasRect?: boolean }
): TableMenuItem[] {
	const items: TableMenuItem[] = [];
	const isCell = target.rowIdx != null && target.colIdx != null;
	if (isCell && clipboard)
		items.push(...clipboardGroup(clipboard.hasSelection || clipboard.hasRect === true), {
			kind: 'separator'
		});
	if (target.rowIdx != null) items.push(...rowGroup(target.rowIdx, dims.rowCount));
	if (isCell) items.push({ kind: 'separator' });
	if (target.colIdx != null) items.push(...columnGroup(target.colIdx, dims.colCount, alignments));
	return items;
}

// Cut/Copy act on the cell selection or the live rectangle, so they're inert
// without either; Paste always applies (clipboard contents aren't readable
// synchronously to gate it).
function clipboardGroup(hasContent: boolean): TableMenuItem[] {
	return [
		{ kind: 'clipboard', action: 'cut', label: 'Cut', enabled: hasContent },
		{ kind: 'clipboard', action: 'copy', label: 'Copy', enabled: hasContent },
		{ kind: 'clipboard', action: 'paste', label: 'Paste', enabled: true }
	];
}

function rowGroup(rowIdx: number, rowCount: number): TableMenuItem[] {
	return [
		{
			kind: 'action',
			action: 'insertRowAbove',
			label: 'Insert row above',
			enabled: true,
			index: rowIdx
		},
		{
			kind: 'action',
			action: 'insertRowBelow',
			label: 'Insert row below',
			enabled: true,
			index: rowIdx
		},
		{
			kind: 'action',
			action: 'moveRowUp',
			label: 'Move row up',
			enabled: tableRowReorderTarget(rowIdx, -1, rowCount) !== null,
			index: rowIdx
		},
		{
			kind: 'action',
			action: 'moveRowDown',
			label: 'Move row down',
			enabled: tableRowReorderTarget(rowIdx, 1, rowCount) !== null,
			index: rowIdx
		},
		{
			kind: 'action',
			action: 'deleteRow',
			label: 'Delete row',
			enabled: canDeleteRow(rowIdx, rowCount),
			index: rowIdx
		}
	];
}

function columnGroup(
	colIdx: number,
	colCount: number,
	alignments: readonly TableAlignment[]
): TableMenuItem[] {
	return [
		{
			kind: 'action',
			action: 'insertColumnLeft',
			label: 'Insert column left',
			enabled: true,
			index: colIdx
		},
		{
			kind: 'action',
			action: 'insertColumnRight',
			label: 'Insert column right',
			enabled: true,
			index: colIdx
		},
		{
			kind: 'action',
			action: 'moveColumnLeft',
			label: 'Move column left',
			enabled: tableColumnReorderTarget(colIdx, -1, colCount) !== null,
			index: colIdx
		},
		{
			kind: 'action',
			action: 'moveColumnRight',
			label: 'Move column right',
			enabled: tableColumnReorderTarget(colIdx, 1, colCount) !== null,
			index: colIdx
		},
		{
			kind: 'action',
			action: 'deleteColumn',
			label: 'Delete column',
			enabled: canDeleteColumn(colCount),
			index: colIdx
		},
		{ kind: 'alignment', current: alignments[colIdx] }
	];
}
