/**
 * Pure model for the table affordance menu: which items a target cell, row, or
 * column offers and whether each is enabled. The component renders this and
 * dispatches `context[action](arg)` on click; enablement reuses the context's
 * own refusal predicates so a disabled item can never reach a no-op commit.
 */
import type { CellShortcutAction } from './cell-keydown-plan';
import type { TableAlignment } from '../../../core/nodes';
import {
	tableRowReorderTarget,
	tableColumnReorderTarget,
	canDeleteRow,
	canDeleteColumn
} from '../../../editor-actions/table-context';

export type TableMenuItem =
	| { kind: 'action'; action: CellShortcutAction; label: string; enabled: boolean }
	| { kind: 'alignment'; current: TableAlignment }
	| { kind: 'separator' };

export function tableMenuItems(
	target: { rowIdx?: number; colIdx?: number },
	dims: { rowCount: number; colCount: number },
	alignments: TableAlignment[]
): TableMenuItem[] {
	const items: TableMenuItem[] = [];
	if (target.rowIdx != null) items.push(...rowGroup(target.rowIdx, dims.rowCount));
	if (target.rowIdx != null && target.colIdx != null) items.push({ kind: 'separator' });
	if (target.colIdx != null) items.push(...columnGroup(target.colIdx, dims.colCount, alignments));
	return items;
}

function rowGroup(rowIdx: number, rowCount: number): TableMenuItem[] {
	return [
		{ kind: 'action', action: 'insertRowAbove', label: 'Insert row above', enabled: true },
		{ kind: 'action', action: 'insertRowBelow', label: 'Insert row below', enabled: true },
		{
			kind: 'action',
			action: 'moveRowUp',
			label: 'Move row up',
			enabled: tableRowReorderTarget(rowIdx, -1, rowCount) !== null
		},
		{
			kind: 'action',
			action: 'moveRowDown',
			label: 'Move row down',
			enabled: tableRowReorderTarget(rowIdx, 1, rowCount) !== null
		},
		{
			kind: 'action',
			action: 'deleteRow',
			label: 'Delete row',
			enabled: canDeleteRow(rowIdx, rowCount)
		}
	];
}

function columnGroup(
	colIdx: number,
	colCount: number,
	alignments: TableAlignment[]
): TableMenuItem[] {
	return [
		{ kind: 'action', action: 'insertColumnLeft', label: 'Insert column left', enabled: true },
		{ kind: 'action', action: 'insertColumnRight', label: 'Insert column right', enabled: true },
		{
			kind: 'action',
			action: 'moveColumnLeft',
			label: 'Move column left',
			enabled: tableColumnReorderTarget(colIdx, -1, colCount) !== null
		},
		{
			kind: 'action',
			action: 'moveColumnRight',
			label: 'Move column right',
			enabled: tableColumnReorderTarget(colIdx, 1, colCount) !== null
		},
		{
			kind: 'action',
			action: 'deleteColumn',
			label: 'Delete column',
			enabled: canDeleteColumn(colCount)
		},
		{ kind: 'alignment', current: alignments[colIdx] }
	];
}
