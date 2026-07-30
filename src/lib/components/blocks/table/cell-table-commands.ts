/**
 * How a cell resolves the table's structural commands: a command id names a
 * `TableContext` mutation plus which of the cell's two coordinates indexes it.
 *
 * The chord half lives on the `tableCell` keymap. This is the half the retired
 * `SHORTCUTS` table carried as a per-row `arg: (state) => state.rowIdx` getter — an
 * argument the binding never needed, because the component running the command owns
 * the coordinates already.
 */

import type { TableAxisAction } from '../../../action-contracts';
import type { AnyCommandId } from '../../../schema/command-id';

export type CommandAxis = 'row' | 'column';

const TABLE_AXIS_COMMANDS: Record<string, { action: TableAxisAction; axis: CommandAxis }> = {
	'table.insertRowBelow': { action: 'insertRowBelow', axis: 'row' },
	'table.insertRowAbove': { action: 'insertRowAbove', axis: 'row' },
	'table.insertColumnRight': { action: 'insertColumnRight', axis: 'column' },
	'table.insertColumnLeft': { action: 'insertColumnLeft', axis: 'column' },
	'table.deleteRow': { action: 'deleteRow', axis: 'row' },
	'table.deleteColumn': { action: 'deleteColumn', axis: 'column' },
	'table.moveRowUp': { action: 'moveRowUp', axis: 'row' },
	'table.moveRowDown': { action: 'moveRowDown', axis: 'row' },
	'table.moveColumnLeft': { action: 'moveColumnLeft', axis: 'column' },
	'table.moveColumnRight': { action: 'moveColumnRight', axis: 'column' },
	'table.cycleAlignment': { action: 'cycleAlignment', axis: 'column' }
};

export function tableAxisCommand(
	id: AnyCommandId
): { action: TableAxisAction; axis: CommandAxis } | null {
	return TABLE_AXIS_COMMANDS[id] ?? null;
}
