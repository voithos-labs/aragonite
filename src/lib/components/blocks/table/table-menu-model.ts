/**
 * Pure model for the table affordance menu: which items a target cell, row, or column
 * offers and whether each is enabled. Enablement reuses the context's own refusal
 * predicates, so a disabled item can never reach a no-op commit.
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
 * Clamp a fixed-position menu's top-left into the viewport (minus `margin`) — menus
 * open at a raw pointer/grip coordinate. Larger than the viewport pins to top/left.
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
	// `index` is the action's own axis index, so a both-axes cell menu routes each item
	// to the right coordinate without the dispatcher tracking which group it came from.
	| { kind: 'action'; action: TableAxisAction; label: string; enabled: boolean; index: number }
	| { kind: 'clipboard'; action: ClipboardAction; label: string; enabled: boolean }
	| { kind: 'alignment'; current: TableAlignment }
	| { kind: 'separator' };

export function tableMenuItems(
	target: { rowIdx?: number; colIdx?: number },
	dims: { rowCount: number; colCount: number },
	alignments: readonly TableAlignment[],
	// Present only for a cell right-click; grip menus never show the clipboard group. A
	// live rectangle (`hasRect`) suppresses the cell-local selection but still serves Cut/Copy.
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

// Paste always applies: clipboard contents aren't readable synchronously to gate it.
function clipboardGroup(hasContent: boolean): TableMenuItem[] {
	return [
		{ kind: 'clipboard', action: 'cut', label: 'Cut', enabled: hasContent },
		{ kind: 'clipboard', action: 'copy', label: 'Copy', enabled: hasContent },
		{ kind: 'clipboard', action: 'paste', label: 'Paste', enabled: true }
	];
}

type AxisEntry = readonly [action: TableAxisAction, label: string, enabled: boolean];

function axisItems(index: number, entries: readonly AxisEntry[]): TableMenuItem[] {
	return entries.map(([action, label, enabled]) => ({
		kind: 'action',
		action,
		label,
		enabled,
		index
	}));
}

function rowGroup(rowIdx: number, rowCount: number): TableMenuItem[] {
	return axisItems(rowIdx, [
		['insertRowAbove', 'Insert row above', true],
		['insertRowBelow', 'Insert row below', true],
		['moveRowUp', 'Move row up', tableRowReorderTarget(rowIdx, -1, rowCount) !== null],
		['moveRowDown', 'Move row down', tableRowReorderTarget(rowIdx, 1, rowCount) !== null],
		['deleteRow', 'Delete row', canDeleteRow(rowIdx, rowCount)]
	]);
}

function columnGroup(
	colIdx: number,
	colCount: number,
	alignments: readonly TableAlignment[]
): TableMenuItem[] {
	return [
		...axisItems(colIdx, [
			['insertColumnLeft', 'Insert column left', true],
			['insertColumnRight', 'Insert column right', true],
			[
				'moveColumnLeft',
				'Move column left',
				tableColumnReorderTarget(colIdx, -1, colCount) !== null
			],
			[
				'moveColumnRight',
				'Move column right',
				tableColumnReorderTarget(colIdx, 1, colCount) !== null
			],
			['deleteColumn', 'Delete column', canDeleteColumn(colCount)]
		]),
		{ kind: 'alignment', current: alignments[colIdx] }
	];
}
