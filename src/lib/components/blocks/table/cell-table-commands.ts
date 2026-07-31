/**
 * How a cell resolves the table's structural commands: a command id names a
 * `TableContext` mutation plus which of the cell's two coordinates indexes it.
 * The chord half lives on the `tableCell` keymap.
 */

import type { TableAxisAction } from '../../../action-contracts';
import type { AnyCommandId } from '../../../schema/command-id';
import type { BlockCommandId } from '../../../schema/commands';

export type CommandAxis = 'row' | 'column';

/** Keying the map by the declared vocabulary makes a new `table.*` id a compile error
 *  here, rather than a bound chord that resolves to nothing at runtime. */
type TableCommandId = Extract<BlockCommandId, `table.${string}`>;

const TABLE_AXIS_COMMANDS: Record<TableCommandId, { action: TableAxisAction; axis: CommandAxis }> =
	{
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
	return TABLE_AXIS_COMMANDS[id as TableCommandId] ?? null;
}
