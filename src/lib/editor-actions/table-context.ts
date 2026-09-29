/**
 * The TableContext edits. The component keeps the sticky column, the focused cell, DOM
 * helpers and BlockComponent; only structural edits live here, each handing its commit the cell
 * the caret goes to.
 */

import type {
	CommitAnnouncement,
	CommitLanding,
	ContainerEditActions,
	TableContext
} from '../action-contracts';
import { CURSOR_END, CURSOR_START } from '../block-component';
import type { CaretPosition } from '../selection/primitives';
import type { OpDescriptor } from '../schema/operations';
import type { CstNode } from '../core/nodes';
import type { Reading } from '../schema/reading';
import type { NodeView } from '../core/node-views';
import { metadataOf } from '../core/nodes';
import { extendDocPath, docPathFrom } from '../cursor/coordinate-spaces';
import type { MultiScopeTarget } from '../action-contracts';
import type { UndoController } from './deps';
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
import { ensureUnsharedChildren, ensureUnsharedSubtree } from '../tree-operations/unshare';
import { writeOwnRaw } from '../tree-operations/node-primitives';
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
 * The header (row 0) stays where it is. Null skips the commit, so a keypress at the edge
 * pushes no undo entry.
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
	/** The editor's reading, whose grammar the cell writes use. */
	reading: Reading;
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
	| 'pasteGrid'
>;

export function createTableMutationsContext(
	deps: TableMutationsContextDeps
): TableMutationsContext {
	/** The cell at `rowIdx`, `colIdx`, addressed by path so the landing can mount a windowed row. */
	const cellAt = (
		rowIdx: number,
		colIdx: number,
		offset: number = CURSOR_START
	): CaretPosition => ({
		path: docPathFrom([...deps.myPath, rowIdx, colIdx]),
		offset
	});

	async function insertRow(rowIdx: number, side: 'above' | 'below'): Promise<void> {
		const { node, myPath, rowsState, parentContainerEdit } = deps;
		const insertAt = side === 'above' ? rowIdx : rowIdx + 1;
		await parentContainerEdit.commitContainer({
			containerNode: node,
			path: [...myPath],
			state: rowsState,
			snapshot: { path: extendDocPath(myPath, rowIdx), offset: 0 },
			mutate: (scope) => {
				insertEmptyRow(scope.node, rowIdx, side);
				scope.sharing.stamp(scope.children[insertAt]);
				return { op: 'insert', at: insertAt, count: 1 };
			},
			op: {
				kind: 'tableInsertRow',
				detail: { rowIdx, side },
				eventPath: extendDocPath(myPath, insertAt)
			},
			landing: () => cellAt(insertAt, 0),
			announce: () => INSERTED_ROW
		});
	}

	/** The table scope plus one per mounted row: an unmounted row has no registered state and
	 *  would throw, and the table scope carries the bytes to every row anyway. */
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
		landing: CommitLanding;
		announce: CommitAnnouncement;
	}): Promise<void> {
		const { myPath, controller } = deps;
		const { scopes, rowIndices } = mountedColumnScopes();
		await controller.commitMultiScope({
			scopes,
			// Columns are not nodes: undo restores to the table itself.
			snapshot: { path: docPathFrom(myPath), offset: 0 },
			mutate: ([tableScope, ...rowScopes]) => {
				// Reaches the unmounted rows the scopes skip, so the per-row cell splice below
				// never writes through a row an undo snapshot shares (G1.9).
				ensureUnsharedChildren(tableScope.node, tableScope.sharing);
				// The splice walks the copied table's rows, so the row scopes' ids and refs only
				// sync correctly while each row view is the child at the index it covers.
				assertInvariant('column-scope-alignment', () =>
					rowScopes.every((s, i) => s.node === tableScope.node.children?.[rowIndices[i]])
						? null
						: {
								code: 'column-scope-alignment',
								message: 'commitColumnEdit: row scopes misaligned with owned table children'
							}
				);
				// One change per row, in row order; pair the mounted rows with theirs.
				const perRow = opts.mutateColumns(tableScope.node);
				return [{ op: 'noop' }, ...rowIndices.map((i) => perRow[i])];
			},
			op: { ...opts.op, eventPath: docPathFrom(myPath) },
			landing: opts.landing,
			announce: opts.announce
		});
	}

	// The table grows only at the bottom and right, so each scope's change is one contiguous
	// insert; cell texts take the cell kind's raw rule in place, and the commit rebuilds the table.
	async function pasteGrid(
		origin: { rowIdx: number; colIdx: number },
		grid: string[][]
	): Promise<void> {
		const { myPath, controller } = deps;
		const rows = grid.length;
		let cols = 0;
		for (const line of grid) cols = Math.max(cols, line.length);
		if (rows === 0 || cols === 0) return;
		const { scopes, rowIndices } = mountedColumnScopes();
		await controller.commitMultiScope({
			scopes,
			snapshot: { path: docPathFrom(myPath), offset: 0 },
			mutate: ([tableScope, ...rowScopes]) => {
				// The subtree, not just the children: cell writes land at depth two, and cells still
				// shared with the undo snapshot would carry the paste into it.
				ensureUnsharedSubtree(tableScope.node, tableScope.sharing);
				assertInvariant('column-scope-alignment', () =>
					rowScopes.every((s, i) => s.node === tableScope.node.children?.[rowIndices[i]])
						? null
						: {
								code: 'column-scope-alignment',
								message: 'pasteGrid: row scopes misaligned with owned table children'
							}
				);
				const table = tableScope.node;
				const oldRows = table.children?.length ?? 0;
				const oldCols = metadataOf(table, 'table').columnCount;
				const needRows = origin.rowIdx + rows;
				const needCols = origin.colIdx + cols;
				for (let r = oldRows; r < needRows; r++) insertEmptyRow(table, r - 1, 'below');
				for (let c = oldCols; c < needCols; c++) insertEmptyColumn(table, c - 1, 'right');
				grid.forEach((line, r) => {
					const cells = table.children![origin.rowIdx + r].children!;
					line.forEach((text, c) =>
						writeOwnRaw(cells[origin.colIdx + c], text, tableScope.lineEnding, deps.reading.grammar)
					);
				});
				const addedRows = needRows - oldRows;
				const addedCols = needCols - oldCols;
				const tableChange: StructuralChange =
					addedRows > 0 ? { op: 'insert', at: oldRows, count: addedRows } : { op: 'noop' };
				const rowChange: StructuralChange =
					addedCols > 0 ? { op: 'insert', at: oldCols, count: addedCols } : { op: 'noop' };
				return [tableChange, ...rowScopes.map(() => rowChange)];
			},
			op: {
				kind: 'tablePasteGrid',
				detail: { rowIdx: origin.rowIdx, colIdx: origin.colIdx, rows, cols },
				eventPath: docPathFrom(myPath)
			},
			landing: () => cellAt(origin.rowIdx + rows - 1, origin.colIdx + cols - 1, CURSOR_END)
		});
	}

	async function insertColumn(colIdx: number, side: 'left' | 'right'): Promise<void> {
		const { focusedCell } = deps;
		const insertAt = side === 'left' ? colIdx : colIdx + 1;
		await commitColumnEdit({
			mutateColumns: (table) => insertEmptyColumn(table, colIdx, side),
			op: { kind: 'tableInsertColumn', detail: { colIdx, side } },
			landing: () => cellAt(focusedCell?.rowIdx ?? 0, insertAt),
			announce: () => INSERTED_COLUMN
		});
	}

	async function reorderRowTo(from: number, to: number): Promise<void> {
		if (from === to) return;
		const { node, myPath, rowsState, parentContainerEdit, focusedCell } = deps;
		const rowCount = node.children?.length ?? 0;
		// Check the source against the live count: a keyboard, menu or drag commit can carry a
		// `from` made stale by a concurrent structural edit. `to` is already clamped.
		if (from < 0 || from >= rowCount) return;
		// focusout nulls focusedCell on the re-render after the commit, so read the column
		// now; the landing would otherwise go to column 0.
		const col = focusedCell?.colIdx ?? 0;
		await parentContainerEdit.commitContainer({
			containerNode: node,
			path: [...myPath],
			state: rowsState,
			snapshot: { path: extendDocPath(myPath, from), offset: 0 },
			mutate: (scope) => reorderChildren(scope.node.children!, from, to),
			op: { kind: 'tableReorderRow', detail: { from, to }, eventPath: extendDocPath(myPath, to) },
			landing: () => cellAt(to, col),
			announce: () => movedRowToPosition(to, rowCount - 1)
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
		const { node, focusedCell } = deps;
		const columnCount = metadataOf(node, 'table').columnCount;
		// Check the source against the live count, as reorderRowTo does.
		if (from < 0 || from >= columnCount) return;
		// focusout nulls focusedCell on the re-render after the commit, so read the row now;
		// the landing would otherwise go to row 0.
		const row = focusedCell?.rowIdx ?? 0;
		await commitColumnEdit({
			mutateColumns: (table) => mutMoveColumn(table, from, to),
			op: { kind: 'tableReorderColumn', detail: { from, to } },
			landing: () => cellAt(row, to),
			announce: () => movedColumnToPosition(to + 1, columnCount)
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
		pasteGrid,
		insertColumnLeft: (colIdx) => insertColumn(colIdx, 'left'),
		insertColumnRight: (colIdx) => insertColumn(colIdx, 'right'),
		reorderRowTo,
		moveRowUp: (rowIdx) => moveRow(rowIdx, -1),
		moveRowDown: (rowIdx) => moveRow(rowIdx, 1),
		reorderColumnTo,
		moveColumnLeft: (colIdx) => moveColumn(colIdx, -1),
		moveColumnRight: (colIdx) => moveColumn(colIdx, 1),

		async deleteRow(rowIdx) {
			const { node, myPath, rowsState, parentContainerEdit, focusedCell } = deps;
			if (!canDeleteRow(rowIdx, node.children?.length ?? 0)) return;
			await parentContainerEdit.commitContainer({
				containerNode: node,
				path: [...myPath],
				state: rowsState,
				snapshot: { path: extendDocPath(myPath, rowIdx), offset: 0 },
				mutate: (scope) => {
					mutDeleteRow(scope.node, rowIdx);
					return { op: 'delete', at: rowIdx, count: 1 };
				},
				op: {
					kind: 'tableDeleteRow',
					detail: { rowIdx },
					eventPath: extendDocPath(myPath, rowIdx)
				},
				announce: () => DELETED_ROW,
				landing: () => {
					// Read through `deps.node`: the `node` read above is the pre-commit object the
					// undo snapshot still shares, so its child count is stale after the delete.
					const newRowCount = deps.node.children?.length ?? 0;
					if (newRowCount === 0) return null;
					const columnCount = metadataOf(deps.node, 'table').columnCount;
					const targetRow = Math.min(rowIdx, newRowCount - 1);
					const targetCol = focusedCell ? Math.min(focusedCell.colIdx, columnCount - 1) : 0;
					return cellAt(targetRow, targetCol);
				}
			});
		},

		async deleteColumn(colIdx) {
			const { node, focusedCell } = deps;
			const meta = metadataOf(node, 'table');
			if (!canDeleteColumn(meta.columnCount)) return;
			await commitColumnEdit({
				mutateColumns: (table) => mutDeleteColumn(table, colIdx),
				op: { kind: 'tableDeleteColumn', detail: { colIdx } },
				announce: () => DELETED_COLUMN,
				landing: () => {
					// deps.node, not the stale pre-commit object, as in deleteRow.
					const newColumnCount = metadataOf(deps.node, 'table').columnCount;
					if (newColumnCount === 0) return null;
					return cellAt(focusedCell?.rowIdx ?? 0, Math.min(colIdx, newColumnCount - 1));
				}
			});
		},

		async cycleAlignment(colIdx) {
			const { node, myPath, rowsState, parentContainerEdit } = deps;
			// A distinct OperationKind so consumers can count alignment cycles apart from
			// metadata edits. The event targets the table: a column index is not a path.
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
			const { node, myPath, rowsState, parentContainerEdit, focusedCell } = deps;
			// Read before the menu's focusout nulls it: the alignment button unmounts on
			// commit, so without a landing the caret falls to <body>.
			const cell = focusedCell;
			// Commits unconditionally: the first table edit also normalizes cell padding, so
			// setting the same value is not a byte no-op.
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
				landing: () => cellAt(cell?.rowIdx ?? 0, colIdx),
				announce: () => (alignment === 'none' ? COLUMN_ALIGNMENT_CLEARED : columnAligned(alignment))
			});
		}
	};
}
