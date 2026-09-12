/**
 * Pure model for the cell menu: which items a cell offers and whether each is enabled.
 * Enablement reuses the context's own refusal predicates, so a disabled item can never reach
 * a no-op commit.
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
 * open at a raw pointer coordinate. Larger than the viewport pins to top/left.
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

/**
 * Where a flyout hung off its parent row ends up on screen: shifted UP just enough to clear the
 * viewport bottom (never above the top margin) and, when its right edge would overflow, flipped
 * to the parent menu's left side. Shifting vertically keeps the hovered row pointing into it;
 * flipping horizontally keeps it off its own parent. Pure, so the two flyouts share one rule.
 */
export function flyoutPlacement(
	flyout: { top: number; bottom: number; right: number; width: number },
	parentMenu: { left: number },
	viewport: { width: number; height: number },
	margin = 8
): { dy: number; flip: boolean } {
	const overflow = flyout.bottom + margin - viewport.height;
	const dy = overflow > 0 ? -Math.min(overflow, Math.max(0, flyout.top - margin)) : 0;
	const overflowsRight = flyout.right + margin > viewport.width;
	const fitsLeft = parentMenu.left - flyout.width - margin >= 0;
	return { dy, flip: overflowsRight && fitsLeft };
}

export type TableMenuItem =
	// `index` is the action's own axis index, so a both-axes cell menu routes each item
	// to the right coordinate without the dispatcher tracking which group it came from.
	| { kind: 'action'; action: TableAxisAction; label: string; enabled: boolean; index: number }
	| { kind: 'clipboard'; action: ClipboardAction; label: string; enabled: boolean }
	| { kind: 'alignment'; current: TableAlignment }
	| { kind: 'separator' }
	/** A flyout: the row's or column's less-used actions behind one entry. */
	| { kind: 'group'; id: 'row' | 'column'; label: string; items: TableMenuItem[] };

export function tableMenuItems(
	cell: { rowIdx: number; colIdx: number },
	dims: { rowCount: number; colCount: number },
	alignments: readonly TableAlignment[],
	// A live rectangle (`hasRect`) suppresses the cell-local selection but still serves Cut/Copy.
	clipboard: { hasSelection: boolean; hasRect?: boolean }
): TableMenuItem[] {
	const rows = rowGroup(cell.rowIdx, dims.rowCount);
	const cols = columnGroup(cell.colIdx, dims.colCount, alignments);
	const isDelete = (i: TableMenuItem) =>
		i.kind === 'action' && (i.action === 'deleteRow' || i.action === 'deleteColumn');
	// A cell knows both axes, so each axis's inserts and moves fold behind one flyout and only
	// the two deletes and the alignment stay in the list.
	return [
		...clipboardGroup(clipboard.hasSelection || clipboard.hasRect === true),
		{ kind: 'separator' },
		{ kind: 'group', id: 'row', label: 'Row', items: rows.filter((i) => !isDelete(i)) },
		{
			kind: 'group',
			id: 'column',
			label: 'Column',
			items: cols.filter((i) => !isDelete(i) && i.kind !== 'alignment')
		},
		{ kind: 'separator' },
		...rows.filter(isDelete),
		...cols.filter(isDelete),
		...cols.filter((i) => i.kind === 'alignment')
	];
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
