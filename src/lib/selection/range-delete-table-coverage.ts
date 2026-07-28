/**
 * Intra-table coverage-driven delete. A full-table/row/column selection lands
 * inside one table block, so it routes to a structural delete of that
 * table/row/column rather than the cross-block range delete. Subset (cell)
 * coverage returns null so the caller falls through to its cell-clear path.
 */

import type { SelectionPoint } from './primitives';
import type { CstNode } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import type { MultiScopeTarget } from '../action-contracts';
import type { StructuralChange } from '../tree-operations/structural-change';
import { deleteNode, emptyParagraph } from '../tree-operations/node-ops';
import { trailingLineEnding } from '../core/lines';
import { expectStateForNode, getStateForNode } from '../reactivity/state-registry';
import {
	deleteRow as mutDeleteRow,
	deleteColumn as mutDeleteColumn,
	canDeleteRow,
	canDeleteColumn
} from '../tree-operations/table-mutations';
import { ensureUnsharedChildren } from '../tree-operations/unshare';
import { cellRowCol, docPathFrom } from '../cursor/coordinate-spaces';
import type { CrossBlockDeleteOptions, CrossBlockMutationContext } from './cross-block/ops';

// ── Coverage classification ──────────────────────────────────────────────────

/**
 * Coverage of an intra-table cell-index range. Drives the Backspace dispatch:
 * full-table → delete table block; full-row → delete row; full-column → delete
 * column; otherwise → clear cells. The discriminated union keeps `rowIdx` /
 * `colIdx` present only on the arm that owns them.
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

/**
 * Returns null when the selection doesn't qualify (subset coverage or guard
 * refusal); the caller falls through to the cell-clear path.
 */
export async function maybeCommitTableCoverageDelete(
	ctx: CrossBlockMutationContext,
	table: CstNode,
	start: SelectionPoint,
	end: SelectionPoint,
	options: Pick<CrossBlockDeleteOptions, 'undoEntry'> | undefined,
	caretRestore: ((caret: SelectionPoint | null) => void) | undefined
): Promise<{ caret: SelectionPoint | null } | null> {
	const meta = metadataOf(table, 'table');
	const columnCount = meta.columnCount;
	const rowCount = table.children?.length ?? 0;
	// Same-path intra-table selection: the endpoints' cell offsets are
	// context-established (same table, unflagged), so they read directly — the
	// cellIndexOf flag-guard is for cross-block table endpoints only.
	const coverage = classifyTableSelectionCoverage(start.offset, end.offset, columnCount, rowCount);

	if (coverage.kind === 'cells') return null;

	if (coverage.kind === 'table') {
		const caret = await commitFullTableDelete(ctx, start, options, caretRestore);
		return { caret };
	}

	if (coverage.kind === 'row') {
		// Mirror Ctrl+Shift+Backspace: ≥1 body row must remain. Refusal is a
		// silent no-op — falling through to a cell-clear would silently
		// rewrite the user's intent.
		if (!canDeleteRow(coverage.rowIdx, rowCount)) return { caret: null };
		const caret = await commitRowDelete(ctx, table, start, coverage.rowIdx, options, caretRestore);
		return { caret };
	}

	if (coverage.kind === 'column') {
		// Mirror Alt+Shift+Backspace: ≥2 columns must remain.
		if (!canDeleteColumn(columnCount)) return { caret: null };
		const caret = await commitColumnDelete(
			ctx,
			table,
			start,
			coverage.colIdx,
			options,
			caretRestore
		);
		return { caret };
	}

	return null;
}

async function commitFullTableDelete(
	ctx: CrossBlockMutationContext,
	start: SelectionPoint,
	options: Pick<CrossBlockDeleteOptions, 'undoEntry'> | undefined,
	caretRestore: ((caret: SelectionPoint | null) => void) | undefined
): Promise<SelectionPoint | null> {
	const tableIdx = start.path[0];
	const snapshot =
		options?.undoEntry === 'join'
			? ('skip' as const)
			: { path: docPathFrom([tableIdx]), offset: 0 };

	let collapsedCaret: SelectionPoint | null = null;
	await ctx.controller.commitStructural({
		snapshot,
		mutate: (children) => {
			// Read before the delete: with the table gone there is no block left to
			// take an ending from, and the filler below IS a line ending (G4.20).
			const lineEnding = trailingLineEnding(children[tableIdx]?.raw ?? '\n');
			const change = deleteNode({ children }, tableIdx, ctx.controller.sharing);
			ctx.selection.collapse();
			// A sole-table doc empties to zero blocks, which leaves no editable
			// block and strands the caret on <body>. Materialize an empty
			// paragraph in the same commit so the descriptor mints its id and the
			// undo entry restores the table in one step.
			if (children.length === 0) {
				const filler = emptyParagraph('', lineEnding);
				ctx.controller.sharing.stamp(filler);
				children.push(filler);
				collapsedCaret = { path: [0], offset: 0 };
				return { op: 'replace', at: 0, count: 1, newCount: 1 };
			}
			const survivorIdx = Math.min(tableIdx, children.length - 1);
			collapsedCaret = { path: [survivorIdx], offset: 0 };
			return change;
		},
		op: {
			kind: 'delete',
			detail: { crossBlock: true, table: 'whole' },
			eventPath: docPathFrom([tableIdx])
		},
		afterTick: caretRestore ? () => caretRestore(collapsedCaret) : undefined
	});
	return collapsedCaret;
}

async function commitRowDelete(
	ctx: CrossBlockMutationContext,
	table: CstNode,
	start: SelectionPoint,
	rowIdx: number,
	options: Pick<CrossBlockDeleteOptions, 'undoEntry'> | undefined,
	caretRestore: ((caret: SelectionPoint | null) => void) | undefined
): Promise<SelectionPoint | null> {
	const tableIdx = start.path[0];
	const rowsState = expectStateForNode(table);
	const snapshot =
		options?.undoEntry === 'join'
			? ('skip' as const)
			: { path: docPathFrom([tableIdx, rowIdx]), offset: 0 };

	let collapsedCaret: SelectionPoint | null = null;
	await ctx.controller.commitContainerStructural({
		containerNode: table,
		path: [tableIdx],
		state: rowsState,
		snapshot,
		mutate: (scope) => {
			// deleteRow promotes the next row to header (a metadata write).
			ensureUnsharedChildren(scope.node, scope.sharing);
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
		afterTick: caretRestore ? () => caretRestore(collapsedCaret) : undefined
	});
	return collapsedCaret;
}

async function commitColumnDelete(
	ctx: CrossBlockMutationContext,
	table: CstNode,
	start: SelectionPoint,
	colIdx: number,
	options: Pick<CrossBlockDeleteOptions, 'undoEntry'> | undefined,
	caretRestore: ((caret: SelectionPoint | null) => void) | undefined
): Promise<SelectionPoint | null> {
	const tableIdx = start.path[0];
	const rowsState = expectStateForNode(table);
	const rows = table.children ?? [];
	// A row's BlockListState registers on mount; a row windowed out of the
	// table's mounted slice has none. Scope only the mounted rows for reactivity —
	// the ensureUnsharedChildren below copy-path-on-writes EVERY row, mounted or
	// not, so the per-row cell splice stays G1.9-safe regardless of mount state.
	const mountedRowScopes: MultiScopeTarget[] = [];
	for (let i = 0; i < rows.length; i++) {
		const state = getStateForNode(rows[i]);
		if (state) mountedRowScopes.push({ node: rows[i], state, path: [tableIdx, i] });
	}
	const scopes: MultiScopeTarget[] = [
		{ node: table, state: rowsState, path: [tableIdx] },
		...mountedRowScopes
	];
	const snapshot =
		options?.undoEntry === 'join'
			? ('skip' as const)
			: { path: docPathFrom([tableIdx]), offset: 0 };

	let collapsedCaret: SelectionPoint | null = null;
	await ctx.controller.commitMultiScope({
		scopes,
		snapshot,
		mutate: (scopeViews) => {
			const ownedTable = scopeViews[0].node;
			// Unshare every row before the splice. Mounted rows are already owned via
			// their scope; this reaches the windowed-out rows the scopes skip.
			ensureUnsharedChildren(ownedTable, scopeViews[0].sharing);
			mutDeleteColumn(ownedTable, colIdx);

			const newColumnCount = metadataOf(ownedTable, 'table').columnCount;
			const targetCol = Math.min(colIdx, Math.max(0, newColumnCount - 1));
			collapsedCaret = { path: [tableIdx, 0, targetCol], offset: 0 };
			ctx.selection.collapse();

			// Every mounted row loses the same cell; the table scope is a no-op.
			const rowDelete: StructuralChange = { op: 'delete', at: colIdx, count: 1 };
			return [{ op: 'noop' }, ...mountedRowScopes.map(() => rowDelete)];
		},
		// Event targets the TABLE — a column index is not a child path (parity
		// with table-context's column ops); colIdx rides in the detail.
		op: {
			kind: 'tableDeleteColumn',
			detail: { colIdx, crossBlock: true },
			eventPath: docPathFrom([tableIdx])
		},
		afterTick: caretRestore ? () => caretRestore(collapsedCaret) : undefined
	});
	return collapsedCaret;
}
