/**
 * Deletes the whole row or column a pair inside one table holds, at the table's own path, as
 * Ctrl+Shift+Backspace and Alt+Shift+Backspace do. The coverage itself is read by `rangeCoverage`.
 */

import { deleteSnapshot, type CaretPosition, type SelectionPoint } from './primitives';
import { metadataOf, type CstNode } from '../core/nodes';
import type { MultiScopeTarget } from '../action-contracts';
import type { StructuralChange } from '../tree-operations/structural-change';
import { expectStateForNode, getStateForNode } from '../reactivity/state-registry';
import {
	deleteRow as mutDeleteRow,
	deleteColumn as mutDeleteColumn,
	canDeleteRow,
	canDeleteColumn
} from '../tree-operations/table-mutations';
import { ensureUnsharedChildren } from '../tree-operations/unshare';
import { blockNodeAt } from '../tree-operations/node-primitives';
import { docPathFrom } from '../cursor/coordinate-spaces';
import type { GridCoverage } from './range-coverage';
import type { CrossBlockMutationContext } from './cross-block/ops';

/** A pair inside one table that holds a whole row or a whole column of it. */
export type GridLineCoverage = Extract<GridCoverage, { kind: 'row' | 'column' }>;

/** The collapsed caret, or null for a refused delete (no body row or one column left), which
 *  clears nothing either; `lands` has the commit put the caret there. */
export async function commitGridLineDelete(
	ctx: CrossBlockMutationContext,
	grid: GridLineCoverage,
	lands: boolean
): Promise<SelectionPoint | null> {
	const table = blockNodeAt(ctx.getDoc(), grid.path);
	if (!table?.children) return null;
	if (grid.kind === 'row') {
		if (!canDeleteRow(grid.rect.top, table.children.length)) return null;
		return commitRowDelete(ctx, table, grid.path, grid.rect.top, lands);
	}
	if (!canDeleteColumn(metadataOf(table, 'table').columnCount)) return null;
	return commitColumnDelete(ctx, table, grid.path, grid.rect.left, lands);
}

// ── Internal ────────────────────────────────────────────────────────────────

async function commitRowDelete(
	ctx: CrossBlockMutationContext,
	table: CstNode,
	tablePath: number[],
	rowIdx: number,
	lands: boolean
): Promise<SelectionPoint | null> {
	const snapshot = deleteSnapshot([...tablePath, rowIdx]);

	let collapsedCaret: SelectionPoint | null = null;
	await ctx.controller.commitContainerStructural({
		containerNode: table,
		path: tablePath,
		state: expectStateForNode(table),
		snapshot,
		mutate: (scope) => {
			// deleteRow promotes the next row to header (a metadata write).
			ensureUnsharedChildren(scope.node, scope.sharing);
			mutDeleteRow(scope.node, rowIdx);
			const newRowCount = scope.node.children?.length ?? 0;
			const targetRow = Math.min(rowIdx, Math.max(0, newRowCount - 1));
			collapsedCaret = { path: [...tablePath, targetRow, 0], offset: 0 };
			ctx.selection.collapse();
			return { op: 'delete', at: rowIdx, count: 1 };
		},
		op: {
			kind: 'tableDeleteRow',
			detail: { rowIdx, crossBlock: true },
			eventPath: docPathFrom([...tablePath, rowIdx])
		},
		landing: lands ? () => cellLanding(collapsedCaret) : undefined
	});
	return collapsedCaret;
}

async function commitColumnDelete(
	ctx: CrossBlockMutationContext,
	table: CstNode,
	tablePath: number[],
	colIdx: number,
	lands: boolean
): Promise<SelectionPoint | null> {
	const rows = table.children ?? [];
	// Only mounted rows have reactive state; `ensureUnsharedChildren` copies every row, so the
	// cell splice never writes a shared node whatever a row's mount state (G1.9).
	const mountedRowScopes: MultiScopeTarget[] = [];
	for (let i = 0; i < rows.length; i++) {
		const state = getStateForNode(rows[i]);
		if (state) mountedRowScopes.push({ node: rows[i], state, path: [...tablePath, i] });
	}
	const scopes: MultiScopeTarget[] = [
		{ node: table, state: expectStateForNode(table), path: tablePath },
		...mountedRowScopes
	];

	let collapsedCaret: SelectionPoint | null = null;
	await ctx.controller.commitMultiScope({
		scopes,
		snapshot: deleteSnapshot(tablePath),
		mutate: (scopeViews) => {
			const ownedTable = scopeViews[0].node;
			// Unshare every row before the splice: mounted rows are already copied through their
			// state, and the call reaches the windowed-out rows that have none.
			ensureUnsharedChildren(ownedTable, scopeViews[0].sharing);
			mutDeleteColumn(ownedTable, colIdx);

			const newColumnCount = metadataOf(ownedTable, 'table').columnCount;
			const targetCol = Math.min(colIdx, Math.max(0, newColumnCount - 1));
			collapsedCaret = { path: [...tablePath, 0, targetCol], offset: 0 };
			ctx.selection.collapse();

			// Every mounted row loses the same cell; the table's own change is a no-op.
			const rowDelete: StructuralChange = { op: 'delete', at: colIdx, count: 1 };
			return [{ op: 'noop' }, ...mountedRowScopes.map(() => rowDelete)];
		},
		// A column index is not a child path, so the event targets the table and the column goes
		// in the detail, as the table's own column edits do.
		op: {
			kind: 'tableDeleteColumn',
			detail: { colIdx, crossBlock: true },
			eventPath: docPathFrom(tablePath)
		},
		landing: lands ? () => cellLanding(collapsedCaret) : undefined
	});
	return collapsedCaret;
}

/** The cell a row or column delete keeps the caret in, as the commit's landing. */
function cellLanding(cell: SelectionPoint | null): CaretPosition | null {
	return cell && { path: docPathFrom(cell.path), offset: cell.offset };
}
