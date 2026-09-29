/**
 * Deletes a whole table, row or column when a selection inside one table covers it, instead of
 * running the cross-block range delete. Partial (cell) coverage returns null so the caller
 * clears cells.
 */

import { cellIndexOf, deleteSnapshot, type CaretPosition, type SelectionPoint } from './primitives';
import { caretPointFor, survivorAfterRemoval, type RemovalGesture } from './caret-target';
import type { CstNode } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import type { MultiScopeTarget } from '../action-contracts';
import type { StructuralChange } from '../tree-operations/structural-change';
import { documentBody } from '../tree-operations/node-primitives';
import { deleteNode } from '../tree-operations/settle';
import { expectStateForNode, getStateForNode } from '../reactivity/state-registry';
import {
	deleteRow as mutDeleteRow,
	deleteColumn as mutDeleteColumn,
	canDeleteRow,
	canDeleteColumn
} from '../tree-operations/table-mutations';
import { ensureUnsharedChildren } from '../tree-operations/unshare';
import { cellRowCol, docPathFrom } from '../cursor/coordinate-spaces';
import type { CrossBlockMutationContext } from './cross-block/ops';

// ── Coverage classification ──────────────────────────────────────────────────

/**
 * Coverage of an intra-table cell-index range, driving the Backspace dispatch: a full
 * table/row/column deletes structurally, anything else clears cells.
 */
export type TableCoverage =
	| { kind: 'table' }
	| { kind: 'row'; rowIdx: number }
	| { kind: 'column'; colIdx: number }
	| { kind: 'cells' };

export function classifyTableSelectionCoverage(
	startCellIdx: number,
	endCellIdx: number,
	columnCount: number,
	rowCount: number
): TableCoverage {
	const lo = Math.min(startCellIdx, endCellIdx);
	const hi = Math.max(startCellIdx, endCellIdx);
	const cellCount = columnCount * rowCount;

	if (lo === 0 && hi === cellCount - 1) return { kind: 'table' };

	const { row: startRow, col: startCol } = cellRowCol(lo, columnCount);
	const { row: endRow, col: endCol } = cellRowCol(hi, columnCount);

	if (startRow === endRow && startCol === 0 && endCol === columnCount - 1) {
		return { kind: 'row', rowIdx: startRow };
	}
	if (startCol === endCol && startRow === 0 && endRow === rowCount - 1) {
		return { kind: 'column', colIdx: startCol };
	}
	return { kind: 'cells' };
}

export interface TableCoverageDeleteOptions {
	/** The commit puts the caret where it returns it. */
	lands: boolean;
	/** What deleted the table, which picks the caret's side when the whole table goes. */
	gesture: RemovalGesture;
}

/** Null when the selection doesn't qualify (subset coverage, or a guard refusal). */
export async function maybeCommitTableCoverageDelete(
	ctx: CrossBlockMutationContext,
	table: CstNode,
	start: SelectionPoint,
	end: SelectionPoint,
	{ lands, gesture }: TableCoverageDeleteOptions
): Promise<{ caret: SelectionPoint | null } | null> {
	const meta = metadataOf(table, 'table');
	const columnCount = meta.columnCount;
	const rowCount = table.children?.length ?? 0;
	const coverage = classifyTableSelectionCoverage(
		cellIndexOf(start, 'maybeCommitTableCoverageDelete:start'),
		cellIndexOf(end, 'maybeCommitTableCoverageDelete:end'),
		columnCount,
		rowCount
	);

	switch (coverage.kind) {
		case 'cells':
			return null;
		case 'table':
			return { caret: await commitFullTableDelete(ctx, start, lands, gesture) };
		case 'row': {
			// As with Ctrl+Shift+Backspace, at least one body row must remain. A refusal does nothing,
			// since falling through to a cell clear would do something the user did not ask for.
			if (!canDeleteRow(coverage.rowIdx, rowCount)) return { caret: null };
			const caret = await commitRowDelete(ctx, table, start, coverage.rowIdx, lands);
			return { caret };
		}
		case 'column': {
			// Mirror Alt+Shift+Backspace: ≥2 columns must remain.
			if (!canDeleteColumn(columnCount)) return { caret: null };
			const caret = await commitColumnDelete(ctx, table, start, coverage.colIdx, lands);
			return { caret };
		}
	}
}

async function commitFullTableDelete(
	ctx: CrossBlockMutationContext,
	start: SelectionPoint,
	lands: boolean,
	gesture: RemovalGesture
): Promise<SelectionPoint | null> {
	const tableIdx = start.path[0];
	const snapshot = deleteSnapshot([tableIdx]);
	// Read on the committed tree, which holds the block the commit gives an emptied document.
	const survivor = () => survivorAfterRemoval(ctx.getDoc(), [tableIdx], gesture);

	const wrote = await ctx.controller.commitStructural({
		snapshot,
		mutate: (children) => {
			const change = deleteNode(
				documentBody(ctx.getDoc(), children),
				tableIdx,
				ctx.reading.grammar,
				ctx.controller.sharing
			);
			ctx.selection.collapse();
			return change;
		},
		op: {
			kind: 'delete',
			detail: { crossBlock: true, table: 'whole' },
			eventPath: docPathFrom([tableIdx])
		},
		landing: lands ? survivor : undefined
	});
	const landed = wrote ? survivor() : null;
	return landed && caretPointFor(ctx.getDoc(), landed);
}

async function commitRowDelete(
	ctx: CrossBlockMutationContext,
	table: CstNode,
	start: SelectionPoint,
	rowIdx: number,
	lands: boolean
): Promise<SelectionPoint | null> {
	const tableIdx = start.path[0];
	const rowsState = expectStateForNode(table);
	const snapshot = deleteSnapshot([tableIdx, rowIdx]);

	let collapsedCaret: SelectionPoint | null = null;
	await ctx.controller.commitContainerStructural({
		containerNode: table,
		path: [tableIdx],
		state: rowsState,
		snapshot,
		mutate: (scope) => {
			mutDeleteRow(scope.node, rowIdx);
			const newRowCount = scope.node.children?.length ?? 0;
			const targetRow = Math.min(rowIdx, Math.max(0, newRowCount - 1));
			collapsedCaret = { path: [tableIdx, targetRow, 0], offset: 0 };
			ctx.selection.collapse();
			return { op: 'delete', at: rowIdx, count: 1 };
		},
		op: {
			kind: 'tableDeleteRow',
			detail: { rowIdx, crossBlock: true },
			eventPath: docPathFrom([tableIdx, rowIdx])
		},
		landing: lands ? () => cellLanding(collapsedCaret) : undefined
	});
	return collapsedCaret;
}

async function commitColumnDelete(
	ctx: CrossBlockMutationContext,
	table: CstNode,
	start: SelectionPoint,
	colIdx: number,
	lands: boolean
): Promise<SelectionPoint | null> {
	const tableIdx = start.path[0];
	const rowsState = expectStateForNode(table);
	const rows = table.children ?? [];
	// Only mounted rows have reactive state; `ensureUnsharedChildren` copies every row, so the
	// cell splice never writes a shared node whatever a row's mount state (G1.9).
	const mountedRowScopes: MultiScopeTarget[] = [];
	for (let i = 0; i < rows.length; i++) {
		const state = getStateForNode(rows[i]);
		if (state) mountedRowScopes.push({ node: rows[i], state, path: [tableIdx, i] });
	}
	const scopes: MultiScopeTarget[] = [
		{ node: table, state: rowsState, path: [tableIdx] },
		...mountedRowScopes
	];
	const snapshot = deleteSnapshot([tableIdx]);

	let collapsedCaret: SelectionPoint | null = null;
	await ctx.controller.commitMultiScope({
		scopes,
		snapshot,
		mutate: (scopeViews) => {
			const ownedTable = scopeViews[0].node;
			// Unshare every row before the splice: mounted rows are already copied through their
			// state, and the call reaches the windowed-out rows that have none.
			ensureUnsharedChildren(ownedTable, scopeViews[0].sharing);
			mutDeleteColumn(ownedTable, colIdx);

			const newColumnCount = metadataOf(ownedTable, 'table').columnCount;
			const targetCol = Math.min(colIdx, Math.max(0, newColumnCount - 1));
			collapsedCaret = { path: [tableIdx, 0, targetCol], offset: 0 };
			ctx.selection.collapse();

			// Every mounted row loses the same cell; the table's own change is a no-op.
			const rowDelete: StructuralChange = { op: 'delete', at: colIdx, count: 1 };
			return [{ op: 'noop' }, ...mountedRowScopes.map(() => rowDelete)];
		},
		// The event targets the table: a column index is not a child path (the table context's
		// column ops do the same), so `colIdx` goes in the detail.
		op: {
			kind: 'tableDeleteColumn',
			detail: { colIdx, crossBlock: true },
			eventPath: docPathFrom([tableIdx])
		},
		landing: lands ? () => cellLanding(collapsedCaret) : undefined
	});
	return collapsedCaret;
}

/** The cell a row or column delete keeps the caret in, as the commit's landing. */
function cellLanding(cell: SelectionPoint | null): CaretPosition | null {
	return cell && { path: docPathFrom(cell.path), offset: cell.offset };
}
