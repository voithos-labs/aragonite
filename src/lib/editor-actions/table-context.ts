/**
 * The TableContext mutation bundle. The component keeps sticky-column state,
 * focused-cell tracking, DOM helpers, and BlockComponent — only structural mutations
 * live here.
 */

import type { CellPosition, ContainerEditActions, TableContext } from '../action-contracts';
import type { OpDescriptor } from '../schema/operations';
import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { metadataOf } from '../core/nodes';
import { extendDocPath, docPathFrom } from '../cursor/coordinate-spaces';
import type { MultiScopeTarget, UndoController } from './deps';
import type { StructuralChange } from '../tree-operations/structural-change';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import { getStateForNode } from '../reactivity/state-registry';
import { assertInvariant } from '../assert';
import {
	columnAligned,
	COLUMN_ALIGNMENT_CLEARED,
	DELETED_COLUMN,
	DELETED_ROW,
	INSERTED_COLUMN,
	INSERTED_ROW,
	movedColumnToPosition,
	movedRowToPosition
} from '../a11y-strings';
import { ensureUnsharedChildren } from '../tree-operations/unshare';
import { rebuildTableRowRaw, rebuildTableRaw } from '../schema/container-rebuilders';
import { reorderChildren } from '../tree-operations/reorder';
import {
	insertEmptyRow,
	insertEmptyColumn,
	deleteRow as mutDeleteRow,
	deleteColumn as mutDeleteColumn,
	moveColumn as mutMoveColumn,
	cycleAlignment as mutCycleAlignment,
	setAlignment as mutSetAlignment,
	canDeleteRow,
	canDeleteColumn
} from '../tree-operations/table-mutations';

/**
 * The header (row 0) is positionally fixed. Null skips the commit, so a boundary
 * press pushes no undo entry.
 */
export function tableRowReorderTarget(
	rowIdx: number,
	dir: -1 | 1,
	rowCount: number
): number | null {
	if (rowIdx === 0) return null;
	const to = rowIdx + dir;
	if (to < 1 || to > rowCount - 1) return null;
	return to;
}

/**
 * Unlike rows, columns have no fixed header, so every index is a valid source and
 * target and clamping spans the full range.
 */
export function tableColumnReorderTarget(
	colIdx: number,
	dir: -1 | 1,
	colCount: number
): number | null {
	const to = colIdx + dir;
	if (to < 0 || to > colCount - 1) return null;
	return to;
}

export interface TableMutationsContextDeps {
	get node(): NodeView;
	get myPath(): readonly number[];
	get rowsState(): BlockListState;
	get focusedCell(): { rowIdx: number; colIdx: number } | null;
	parentContainerEdit: ContainerEditActions;
	controller: UndoController;
	focusCell: (rowIdx: number, colIdx: number, position: CellPosition) => void;
	announceReorder: (message: string) => void;
}

export type TableMutationsContext = Pick<
	TableContext,
	| 'insertRowAbove'
	| 'insertRowBelow'
	| 'insertColumnLeft'
	| 'insertColumnRight'
	| 'deleteRow'
	| 'deleteColumn'
	| 'reorderRowTo'
	| 'moveRowUp'
	| 'moveRowDown'
	| 'reorderColumnTo'
	| 'moveColumnLeft'
	| 'moveColumnRight'
	| 'cycleAlignment'
	| 'setColumnAlignment'
>;

export function createTableMutationsContext(
	deps: TableMutationsContextDeps
): TableMutationsContext {
	async function insertRow(rowIdx: number, side: 'above' | 'below'): Promise<void> {
		const { node, myPath, rowsState, parentContainerEdit, focusCell } = deps;
		const insertAt = side === 'above' ? rowIdx : rowIdx + 1;
		await parentContainerEdit.commitContainer({
			containerNode: node,
			path: [...myPath],
			state: rowsState,
			snapshot: { path: extendDocPath(myPath, rowIdx), offset: 0 },
			mutate: (scope) => {
				insertEmptyRow(scope.node, rowIdx, side);
				scope.sharing.stamp(scope.children[insertAt]);
				rebuildTableRowRaw(scope.children[insertAt]);
				return { op: 'insert', at: insertAt, count: 1 };
			},
			op: {
				kind: 'tableInsertRow',
				detail: { rowIdx, side },
				eventPath: extendDocPath(myPath, insertAt)
			},
			afterTick: () => {
				focusCell(insertAt, 0, 'start');
				deps.announceReorder(INSERTED_ROW);
			}
		});
	}

	/**
	 * The table scope plus one per MOUNTED row: a row's BlockListState registers on
	 * mount, so scoping a windowed-out row throws and takes the gesture with it. The
	 * bytes still reach every row, through the table scope.
	 */
	function mountedColumnScopes(): { scopes: MultiScopeTarget[]; rowIndices: number[] } {
		const { node, myPath, rowsState } = deps;
		const scopes: MultiScopeTarget[] = [{ node, state: rowsState, path: [...myPath] }];
		const rowIndices: number[] = [];
		(node.children ?? []).forEach((row, i) => {
			const state = getStateForNode(row);
			if (!state) return;
			scopes.push({ node: row, state, path: [...myPath, i] });
			rowIndices.push(i);
		});
		return { scopes, rowIndices };
	}

	async function commitColumnEdit(opts: {
		mutateColumns: (table: CstNode) => StructuralChange[];
		op: Extract<
			OpDescriptor,
			{ kind: 'tableInsertColumn' | 'tableDeleteColumn' | 'tableReorderColumn' }
		>;
		afterTick: () => void;
	}): Promise<void> {
		const { myPath, controller } = deps;
		const { scopes, rowIndices } = mountedColumnScopes();
		await controller.commitMultiScope({
			scopes,
			// Columns aren't nodes: the table itself is the restore coordinate.
			snapshot: { path: docPathFrom(myPath), offset: 0 },
			mutate: ([tableScope, ...rowScopes]) => {
				// Reaches the windowed-out rows the scopes skip, so the per-row cell splice
				// below never writes through a snapshot-shared row (G1.9).
				ensureUnsharedChildren(tableScope.node, tableScope.sharing);
				// The splice walks the owned table's rows, so the row scopes' ids/refs only
				// sync correctly while each row view IS the child at the index it covers.
				assertInvariant('column-scope-alignment', () =>
					rowScopes.every((s, i) => s.node === tableScope.node.children?.[rowIndices[i]])
						? null
						: {
								code: 'column-scope-alignment',
								message: 'commitColumnEdit: row scopes misaligned with owned table children'
							}
				);
				// One change per row, in row order — pair the mounted rows with theirs.
				const perRow = opts.mutateColumns(tableScope.node);
				return [{ op: 'noop' }, ...rowIndices.map((i) => perRow[i])];
			},
			op: { ...opts.op, eventPath: docPathFrom(myPath) },
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
				deps.announceReorder(INSERTED_COLUMN);
			}
		});
	}

	async function reorderRowTo(from: number, to: number): Promise<void> {
		if (from === to) return;
		const { node, myPath, rowsState, parentContainerEdit, focusCell, focusedCell } = deps;
		const rowCount = node.children?.length ?? 0;
		// Guard the SOURCE against the live count: a keyboard/menu/drag commit can carry
		// a `from` staled by a concurrent structural edit. `to` is already clamped.
		if (from < 0 || from >= rowCount) return;
		// focusout nulls focusedCell on the post-commit re-render, so capture the column
		// now; the afterTick would otherwise land at column 0.
		const col = focusedCell?.colIdx ?? 0;
		await parentContainerEdit.commitContainer({
			containerNode: node,
			path: [...myPath],
			state: rowsState,
			snapshot: { path: extendDocPath(myPath, from), offset: 0 },
			mutate: (scope) => {
				// rebuildTableRaw rewrites EVERY row's raw, so the rows must be unshared
				// first — reorderChildren only permutes references.
				ensureUnsharedChildren(scope.node, scope.sharing);
				const change = reorderChildren(scope.node.children!, from, to);
				rebuildTableRaw(scope.node);
				return change;
			},
			op: { kind: 'tableReorderRow', detail: { from, to }, eventPath: extendDocPath(myPath, to) },
			afterTick: () => {
				focusCell(to, col, 'start');
				deps.announceReorder(movedRowToPosition(to, rowCount - 1));
			}
		});
	}

	async function moveRow(rowIdx: number, dir: -1 | 1): Promise<void> {
		const rowCount = deps.node.children?.length ?? 0;
		const to = tableRowReorderTarget(rowIdx, dir, rowCount);
		if (to === null) return;
		await reorderRowTo(rowIdx, to);
	}

	async function reorderColumnTo(from: number, to: number): Promise<void> {
		if (from === to) return;
		const { node, focusCell, focusedCell } = deps;
		const columnCount = metadataOf(node, 'table').columnCount;
		// Guard the SOURCE against the live count — see reorderRowTo.
		if (from < 0 || from >= columnCount) return;
		// focusout nulls focusedCell on the post-commit re-render, so capture the row
		// now; the afterTick would otherwise land at row 0.
		const row = focusedCell?.rowIdx ?? 0;
		await commitColumnEdit({
			mutateColumns: (table) => mutMoveColumn(table, from, to),
			op: { kind: 'tableReorderColumn', detail: { from, to } },
			afterTick: () => {
				focusCell(row, to, 'start');
				deps.announceReorder(movedColumnToPosition(to + 1, columnCount));
			}
		});
	}

	async function moveColumn(colIdx: number, dir: -1 | 1): Promise<void> {
		const columnCount = metadataOf(deps.node, 'table').columnCount;
		const to = tableColumnReorderTarget(colIdx, dir, columnCount);
		if (to === null) return;
		await reorderColumnTo(colIdx, to);
	}

	return {
		insertRowAbove: (rowIdx) => insertRow(rowIdx, 'above'),
		insertRowBelow: (rowIdx) => insertRow(rowIdx, 'below'),
		insertColumnLeft: (colIdx) => insertColumn(colIdx, 'left'),
		insertColumnRight: (colIdx) => insertColumn(colIdx, 'right'),
		reorderRowTo,
		moveRowUp: (rowIdx) => moveRow(rowIdx, -1),
		moveRowDown: (rowIdx) => moveRow(rowIdx, 1),
		reorderColumnTo,
		moveColumnLeft: (colIdx) => moveColumn(colIdx, -1),
		moveColumnRight: (colIdx) => moveColumn(colIdx, 1),

		async deleteRow(rowIdx) {
			const { node, myPath, rowsState, parentContainerEdit, focusCell, focusedCell } = deps;
			if (!canDeleteRow(rowIdx, node.children?.length ?? 0)) return;
			await parentContainerEdit.commitContainer({
				containerNode: node,
				path: [...myPath],
				state: rowsState,
				snapshot: { path: extendDocPath(myPath, rowIdx), offset: 0 },
				mutate: (scope) => {
					// deleteRow promotes the next row to header (a metadata write).
					ensureUnsharedChildren(scope.node, scope.sharing);
					mutDeleteRow(scope.node, rowIdx);
					return { op: 'delete', at: rowIdx, count: 1 };
				},
				op: {
					kind: 'tableDeleteRow',
					detail: { rowIdx },
					eventPath: extendDocPath(myPath, rowIdx)
				},
				afterTick: () => {
					deps.announceReorder(DELETED_ROW);
					// Read through `deps.node`: the captured `node` is the pre-commit object
					// the snapshot still shares, so its child count is stale after the delete.
					const newRowCount = deps.node.children?.length ?? 0;
					if (newRowCount === 0) return;
					const columnCount = metadataOf(deps.node, 'table').columnCount;
					const targetRow = Math.min(rowIdx, newRowCount - 1);
					const targetCol = focusedCell ? Math.min(focusedCell.colIdx, columnCount - 1) : 0;
					focusCell(targetRow, targetCol, 'start');
				}
			});
		},

		async deleteColumn(colIdx) {
			const { node, focusCell, focusedCell } = deps;
			const meta = metadataOf(node, 'table');
			if (!canDeleteColumn(meta.columnCount)) return;
			await commitColumnEdit({
				mutateColumns: (table) => mutDeleteColumn(table, colIdx),
				op: { kind: 'tableDeleteColumn', detail: { colIdx } },
				afterTick: () => {
					deps.announceReorder(DELETED_COLUMN);
					// deps.node, not the stale pre-commit capture — see deleteRow.
					const newColumnCount = metadataOf(deps.node, 'table').columnCount;
					if (newColumnCount === 0) return;
					const targetCol = Math.min(colIdx, newColumnCount - 1);
					const targetRow = focusedCell?.rowIdx ?? 0;
					focusCell(targetRow, targetCol, 'start');
				}
			});
		},

		async cycleAlignment(colIdx) {
			const { node, myPath, rowsState, parentContainerEdit } = deps;
			// Distinct OperationKind so consumers can count alignment cycles apart from
			// metadata edits. The event targets the TABLE: a column index is not a path.
			await parentContainerEdit.commitContainer({
				containerNode: node,
				path: [...myPath],
				state: rowsState,
				snapshot: { path: docPathFrom(myPath), offset: 0 },
				mutate: (scope) => {
					mutCycleAlignment(scope.node, colIdx);
					return { op: 'noop' };
				},
				op: { kind: 'tableCycleAlignment', detail: { colIdx }, eventPath: docPathFrom(myPath) }
			});
		},

		async setColumnAlignment(colIdx, alignment) {
			const { node, myPath, rowsState, parentContainerEdit, focusCell, focusedCell } = deps;
			// Capture before the menu's focusout nulls it: the alignment button unmounts
			// on commit, so without a refocus the caret falls to <body>.
			const cell = focusedCell;
			// Commits unconditionally: the first table mutation also normalizes cell
			// padding, so a same-value set is not a byte no-op.
			await parentContainerEdit.commitContainer({
				containerNode: node,
				path: [...myPath],
				state: rowsState,
				snapshot: { path: docPathFrom(myPath), offset: 0 },
				mutate: (scope) => {
					mutSetAlignment(scope.node, colIdx, alignment);
					return { op: 'noop' };
				},
				op: { kind: 'tableSetAlignment', detail: { colIdx }, eventPath: docPathFrom(myPath) },
				afterTick: () => {
					focusCell(cell?.rowIdx ?? 0, colIdx, 'start');
					deps.announceReorder(
						alignment === 'none' ? COLUMN_ALIGNMENT_CLEARED : columnAligned(alignment)
					);
				}
			});
		}
	};
}
