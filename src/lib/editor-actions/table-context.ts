/**
 * Factory for the TableContext mutation bundle: row/column insert/delete and
 * column-alignment cycling. The component owns sticky-column state, focused-cell
 * tracking, DOM helpers, and BlockComponent — only structural mutations live here.
 */

import type { CellPosition, ContainerEditActions, TableContext } from '../action-contracts';
import type { OpDescriptor } from '../schema/operations';
import type { CstNode } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import type { MultiScopeTarget, UndoController } from './deps';
import type { StructuralChange } from '../tree-operations/structural-change';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import { expectStateForNode } from '../reactivity/state-registry';
import { assertInvariant } from '../invariants/assert';
import { ensureUnsharedChildren } from '../tree-operations/unshare';
import { rebuildTableRowRaw } from '../schema/container-raw';
import {
	insertEmptyRow,
	insertEmptyColumn,
	deleteRow as mutDeleteRow,
	deleteColumn as mutDeleteColumn,
	cycleAlignment as mutCycleAlignment
} from '../tree-operations/table-mutations';

export interface TableMutationsContextDeps {
	get node(): CstNode;
	get index(): number;
	get myPath(): readonly number[];
	get rowsState(): BlockListState;
	get focusedCell(): { rowIdx: number; colIdx: number } | null;
	parentContainerEdit: ContainerEditActions;
	controller: UndoController;
	focusCell: (rowIdx: number, colIdx: number, position: CellPosition) => void;
}

export type TableMutationsContext = Pick<
	TableContext,
	| 'insertRowAbove'
	| 'insertRowBelow'
	| 'insertColumnLeft'
	| 'insertColumnRight'
	| 'deleteRow'
	| 'deleteColumn'
	| 'cycleAlignment'
>;

export function createTableMutationsContext(
	deps: TableMutationsContextDeps
): TableMutationsContext {
	async function insertRow(rowIdx: number, side: 'above' | 'below'): Promise<void> {
		const { node, index, myPath, rowsState, parentContainerEdit, focusCell } = deps;
		const insertAt = side === 'above' ? rowIdx : rowIdx + 1;
		await parentContainerEdit.commitContainer({
			containerNode: node,
			path: [...myPath],
			state: rowsState,
			snapshot: { blockIndex: index, offset: 0 },
			mutate: (scope) => {
				insertEmptyRow(scope.node, rowIdx, side);
				scope.sharing.stamp(scope.children[insertAt]);
				rebuildTableRowRaw(scope.children[insertAt]);
				return { op: 'insert', at: insertAt, count: 1 };
			},
			op: { kind: 'tableInsertRow', detail: { rowIdx, side }, eventPath: [index, insertAt] },
			afterTick: () => focusCell(insertAt, 0, 'start')
		});
	}

	function columnScopes(): MultiScopeTarget[] {
		const { node, myPath, rowsState } = deps;
		return [
			{ node, state: rowsState, path: [...myPath] },
			...(node.children ?? []).map((row, i) => ({
				node: row,
				state: expectStateForNode(row),
				path: [...myPath, i]
			}))
		];
	}

	async function commitColumnEdit(opts: {
		mutateColumns: (table: CstNode) => StructuralChange[];
		op: Extract<OpDescriptor, { kind: 'tableInsertColumn' | 'tableDeleteColumn' }>;
		afterTick: () => void;
	}): Promise<void> {
		const { index, myPath, controller } = deps;
		await controller.commitMultiScope({
			scopes: columnScopes(),
			snapshot: { blockIndex: index, offset: 0 },
			mutate: ([tableScope, ...rowScopes]) => {
				// The column splice walks the owned table's rows; this only syncs the
				// row scopes' ids/refs correctly because each row view IS that child.
				assertInvariant('column-scope-alignment', () =>
					rowScopes.every((s, i) => s.node === tableScope.node.children?.[i])
						? null
						: {
								code: 'column-scope-alignment',
								message: 'commitColumnEdit: row scopes misaligned with owned table children'
							}
				);
				return [{ op: 'noop' }, ...opts.mutateColumns(tableScope.node)];
			},
			op: { ...opts.op, eventPath: [...myPath] },
			afterTick: opts.afterTick
		});
	}

	async function insertColumn(colIdx: number, side: 'left' | 'right'): Promise<void> {
		const { focusCell, focusedCell } = deps;
		const insertAt = side === 'left' ? colIdx : colIdx + 1;
		await commitColumnEdit({
			mutateColumns: (table) => insertEmptyColumn(table, colIdx, side),
			op: { kind: 'tableInsertColumn', detail: { colIdx, side } },
			afterTick: () => {
				const targetRow = focusedCell?.rowIdx ?? 0;
				focusCell(targetRow, insertAt, 'start');
			}
		});
	}

	return {
		insertRowAbove: (rowIdx) => insertRow(rowIdx, 'above'),
		insertRowBelow: (rowIdx) => insertRow(rowIdx, 'below'),
		insertColumnLeft: (colIdx) => insertColumn(colIdx, 'left'),
		insertColumnRight: (colIdx) => insertColumn(colIdx, 'right'),

		async deleteRow(rowIdx) {
			const { node, index, myPath, rowsState, parentContainerEdit, focusCell, focusedCell } = deps;
			if ((node.children?.length ?? 0) <= 1) return;
			const willRemoveHeader = rowIdx === 0;
			const bodyCount = (node.children?.length ?? 0) - 1;
			if (!willRemoveHeader && bodyCount <= 1) return;
			await parentContainerEdit.commitContainer({
				containerNode: node,
				path: [...myPath],
				state: rowsState,
				snapshot: { blockIndex: index, offset: 0 },
				mutate: (scope) => {
					// deleteRow promotes the next row to header (a metadata write).
					ensureUnsharedChildren(scope.node, scope.sharing);
					mutDeleteRow(scope.node, rowIdx);
					return { op: 'delete', at: rowIdx, count: 1 };
				},
				op: { kind: 'tableDeleteRow', detail: { rowIdx }, eventPath: [index, rowIdx] },
				afterTick: () => {
					const newRowCount = node.children?.length ?? 0;
					if (newRowCount === 0) return;
					const columnCount = metadataOf(node, 'table').columnCount;
					const targetRow = Math.min(rowIdx, newRowCount - 1);
					const targetCol = focusedCell ? Math.min(focusedCell.colIdx, columnCount - 1) : 0;
					focusCell(targetRow, targetCol, 'start');
				}
			});
		},

		async deleteColumn(colIdx) {
			const { node, focusCell, focusedCell } = deps;
			const meta = metadataOf(node, 'table');
			if (meta.columnCount <= 1) return;
			await commitColumnEdit({
				mutateColumns: (table) => mutDeleteColumn(table, colIdx),
				op: { kind: 'tableDeleteColumn', detail: { colIdx } },
				afterTick: () => {
					const newColumnCount = metadataOf(node, 'table').columnCount;
					if (newColumnCount === 0) return;
					const targetCol = Math.min(colIdx, newColumnCount - 1);
					const targetRow = focusedCell?.rowIdx ?? 0;
					focusCell(targetRow, targetCol, 'start');
				}
			});
		},

		async cycleAlignment(colIdx) {
			const { node, index, myPath, rowsState, parentContainerEdit } = deps;
			// Distinct OperationKind (not metadataUpdate) so consumers can count
			// alignment cycles separately from generic metadata edits.
			await parentContainerEdit.commitContainer({
				containerNode: node,
				path: [...myPath],
				state: rowsState,
				snapshot: { blockIndex: index, offset: 0 },
				mutate: (scope) => {
					mutCycleAlignment(scope.node, colIdx);
					return { op: 'noop' };
				},
				op: { kind: 'tableCycleAlignment', detail: { colIdx }, eventPath: [index, colIdx] }
			});
		}
	};
}
