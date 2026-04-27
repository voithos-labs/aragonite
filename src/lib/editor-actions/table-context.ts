/**
 * Factory for the TableContext mutation bundle: row/column insert/delete and
 * column-alignment cycling. The component owns sticky-column state, focused-cell
 * tracking, DOM helpers, and BlockComponent — only structural mutations live here.
 */

import type { CstNode, TableMetadata } from '../core/nodes';
import type {
	CellPosition,
	ContainerEditActions,
	TableContext
} from '../contracts';
import type { MultiScopeTarget, UndoController } from './deps';
import type { StructuralChange } from '../tree-operations/structural-change';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import { expectStateForNode } from '../reactivity/state-registry';
import { rebuildContainerRaw, rebuildTableRowRaw } from '../schema/container-raw';
import {
	insertEmptyRow,
	insertEmptyColumn,
	deleteRow as mutDeleteRow,
	deleteColumn as mutDeleteColumn,
	cycleAlignment as mutCycleAlignment
} from '../components/blocks/table/table-mutations';

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
		const { node, index, rowsState, parentContainerEdit, focusCell } = deps;
		const insertAt = side === 'above' ? rowIdx : rowIdx + 1;
		await parentContainerEdit.commitContainer({
			containerNode: node,
			state: rowsState,
			snapshot: { blockIndex: index, offset: 0 },
			mutate: (children) => {
				insertEmptyRow(node, rowIdx, side);
				rebuildTableRowRaw(node.children![insertAt]);
				children.length = 0;
				children.push(...node.children!);
				rebuildContainerRaw(node);
				return { op: 'insert', at: insertAt, count: 1 };
			},
			op: { kind: 'tableInsertRow', detail: { rowIdx, side }, eventPath: [index, insertAt] },
			afterTick: () => focusCell(insertAt, 0, 'start')
		});
	}

	async function commitColumnEdit(opts: {
		mutateInPlace: () => void;
		op: { kind: 'tableInsertColumn' | 'tableDeleteColumn'; detail: Record<string, unknown> };
		rowChange: (at: number) => StructuralChange;
		rowChangeAt: number;
		afterTick: () => void;
	}): Promise<void> {
		const { node, index, myPath, rowsState, controller } = deps;
		const rows = node.children ?? [];
		const scopes: MultiScopeTarget[] = [
			{ node, state: rowsState },
			...rows.map((row) => ({ node: row, state: expectStateForNode(row) }))
		];
		await controller.commitMultiScope({
			scopes,
			snapshot: { blockIndex: index, offset: 0 },
			mutate: (scopeChildren) => {
				opts.mutateInPlace();
				syncScopeChildren(node, scopeChildren);
				for (const row of node.children ?? []) rebuildTableRowRaw(row);
				rebuildContainerRaw(node);
				const rowChanges = (node.children ?? []).map(() => opts.rowChange(opts.rowChangeAt));
				return [{ op: 'noop' }, ...rowChanges];
			},
			op: { kind: opts.op.kind, detail: opts.op.detail, eventPath: [...myPath] },
			afterTick: opts.afterTick
		});
	}

	async function insertColumn(colIdx: number, side: 'left' | 'right'): Promise<void> {
		const { node, focusCell, focusedCell } = deps;
		const insertAt = side === 'left' ? colIdx : colIdx + 1;
		await commitColumnEdit({
			rowChangeAt: insertAt,
			mutateInPlace: () => insertEmptyColumn(node, colIdx, side),
			op: { kind: 'tableInsertColumn', detail: { colIdx, side } },
			rowChange: (at) => ({ op: 'insert', at, count: 1 }),
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
			const { node, index, rowsState, parentContainerEdit, focusCell, focusedCell } = deps;
			if ((node.children?.length ?? 0) <= 1) return;
			const willRemoveHeader = rowIdx === 0;
			const bodyCount = (node.children?.length ?? 0) - 1;
			if (!willRemoveHeader && bodyCount <= 1) return;
			await parentContainerEdit.commitContainer({
				containerNode: node,
				state: rowsState,
				snapshot: { blockIndex: index, offset: 0 },
				mutate: (children) => {
					mutDeleteRow(node, rowIdx);
					children.length = 0;
					children.push(...node.children!);
					rebuildContainerRaw(node);
					return { op: 'delete', at: rowIdx, count: 1 };
				},
				op: { kind: 'tableDeleteRow', detail: { rowIdx }, eventPath: [index, rowIdx] },
				afterTick: () => {
					const newRowCount = node.children?.length ?? 0;
					if (newRowCount === 0) return;
					const columnCount = (node.metadata as TableMetadata).columnCount;
					const targetRow = Math.min(rowIdx, newRowCount - 1);
					const targetCol = focusedCell ? Math.min(focusedCell.colIdx, columnCount - 1) : 0;
					focusCell(targetRow, targetCol, 'start');
				}
			});
		},

		async deleteColumn(colIdx) {
			const { node, focusCell, focusedCell } = deps;
			const meta = node.metadata as TableMetadata;
			if (meta.columnCount <= 1) return;
			await commitColumnEdit({
				rowChangeAt: colIdx,
				mutateInPlace: () => mutDeleteColumn(node, colIdx),
				op: { kind: 'tableDeleteColumn', detail: { colIdx } },
				rowChange: (at) => ({ op: 'delete', at, count: 1 }),
				afterTick: () => {
					const newColumnCount = (node.metadata as TableMetadata).columnCount;
					if (newColumnCount === 0) return;
					const targetCol = Math.min(colIdx, newColumnCount - 1);
					const targetRow = focusedCell?.rowIdx ?? 0;
					focusCell(targetRow, targetCol, 'start');
				}
			});
		},

		async cycleAlignment(colIdx) {
			const { node, index, rowsState, parentContainerEdit } = deps;
			// Distinct OperationKind (not metadataUpdate) so consumers can count
			// alignment cycles separately from generic metadata edits.
			await parentContainerEdit.commitContainer({
				containerNode: node,
				state: rowsState,
				snapshot: { blockIndex: index, offset: 0 },
				mutate: () => {
					mutCycleAlignment(node, colIdx);
					rebuildContainerRaw(node);
					return { op: 'noop' };
				},
				op: { kind: 'tableCycleAlignment', detail: { colIdx }, eventPath: [index, colIdx] }
			});
		}
	};
}

// Multi-scope mutate gets per-scope children copies; the table mutation helpers
// operate on node.children directly, so re-publish each scope from the live tree
// before returning.
function syncScopeChildren(
	node: CstNode,
	scopeChildren: { children: CstNode[] }[]
): void {
	const tableScope = scopeChildren[0];
	tableScope.children.length = 0;
	tableScope.children.push(...(node.children ?? []));
	const rows = node.children ?? [];
	for (let i = 0; i < rows.length; i++) {
		const rowScope = scopeChildren[i + 1];
		rowScope.children.length = 0;
		rowScope.children.push(...(rows[i].children ?? []));
	}
}
