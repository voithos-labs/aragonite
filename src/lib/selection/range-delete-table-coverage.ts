/**
 * Intra-table coverage-driven delete. A full-table/row/column selection lands
 * inside one table block, so it routes to a structural delete of that
 * table/row/column rather than the cross-block range delete. Subset (cell)
 * coverage returns null so the caller falls through to its cell-clear path.
 */

import type { UndoEntryMode } from '../action-contracts';
import type { SelectionPoint } from './primitives';
import type { CstNode } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import type { MultiScopeTarget } from '../action-contracts';
import { deleteNode } from '../tree-operations/node-ops';
import { expectStateForNode } from '../reactivity/state-registry';
import { classifyTableSelectionCoverage } from './range-delete-table';
import {
	deleteRow as mutDeleteRow,
	deleteColumn as mutDeleteColumn,
	canDeleteRow,
	canDeleteColumn
} from '../tree-operations/table-mutations';
import { ensureUnsharedChildren } from '../tree-operations/unshare';
import type { CrossBlockMutationContext } from './cross-block/ops';

/**
 * Returns null when the selection doesn't qualify (subset coverage or guard
 * refusal); the caller falls through to the cell-clear path.
 */
export async function maybeCommitTableCoverageDelete(
	ctx: CrossBlockMutationContext,
	table: CstNode,
	start: SelectionPoint,
	end: SelectionPoint,
	options: { undoEntry?: UndoEntryMode } | undefined,
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
		if (!canDeleteRow(coverage.rowIdx!, rowCount)) return { caret: null };
		const caret = await commitRowDelete(ctx, table, start, coverage.rowIdx!, options, caretRestore);
		return { caret };
	}

	if (coverage.kind === 'column') {
		// Mirror Alt+Shift+Backspace: ≥2 columns must remain.
		if (!canDeleteColumn(columnCount)) return { caret: null };
		const caret = await commitColumnDelete(
			ctx,
			table,
			start,
			coverage.colIdx!,
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
	options: { undoEntry?: UndoEntryMode } | undefined,
	caretRestore: ((caret: SelectionPoint | null) => void) | undefined
): Promise<SelectionPoint | null> {
	const tableIdx = start.path[0];
	const snapshot =
		options?.undoEntry === 'join' ? ('skip' as const) : { path: [tableIdx], offset: 0 };

	let collapsedCaret: SelectionPoint | null = null;
	await ctx.controller.commitStructural({
		snapshot,
		mutate: (children) => {
			const change = deleteNode({ children }, tableIdx, ctx.controller.sharing);
			ctx.selection.collapse();
			// A sole-table doc empties to zero blocks, which leaves no editable
			// block and strands the caret on <body>. Materialize an empty
			// paragraph in the same commit so the descriptor mints its id and the
			// undo entry restores the table in one step.
			if (children.length === 0) {
				const filler = makeEmptyParagraph();
				ctx.controller.sharing.stamp(filler);
				children.push(filler);
				collapsedCaret = { path: [0], offset: 0 };
				return { op: 'replace', at: 0, count: 1, newCount: 1 };
			}
			const survivorIdx = Math.min(tableIdx, children.length - 1);
			collapsedCaret = { path: [survivorIdx], offset: 0 };
			return change;
		},
		op: { kind: 'delete', detail: { crossBlock: true, table: 'whole' }, eventPath: [tableIdx] },
		afterTick: caretRestore ? () => caretRestore(collapsedCaret) : undefined
	});
	return collapsedCaret;
}

// Mirrors initDocument's empty-doc backstop and rangeDelete's reparse fallback.
function makeEmptyParagraph(): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw: '\n' };
}

async function commitRowDelete(
	ctx: CrossBlockMutationContext,
	table: CstNode,
	start: SelectionPoint,
	rowIdx: number,
	options: { undoEntry?: UndoEntryMode } | undefined,
	caretRestore: ((caret: SelectionPoint | null) => void) | undefined
): Promise<SelectionPoint | null> {
	const tableIdx = start.path[0];
	const rowsState = expectStateForNode(table);
	const snapshot =
		options?.undoEntry === 'join' ? ('skip' as const) : { path: [tableIdx, rowIdx], offset: 0 };

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
			eventPath: [tableIdx, rowIdx]
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
	options: { undoEntry?: UndoEntryMode } | undefined,
	caretRestore: ((caret: SelectionPoint | null) => void) | undefined
): Promise<SelectionPoint | null> {
	const tableIdx = start.path[0];
	const rowsState = expectStateForNode(table);
	const rows = table.children ?? [];
	const scopes: MultiScopeTarget[] = [
		{ node: table, state: rowsState, path: [tableIdx] },
		...rows.map((row, i) => ({
			node: row,
			state: expectStateForNode(row),
			path: [tableIdx, i]
		}))
	];
	const snapshot =
		options?.undoEntry === 'join' ? ('skip' as const) : { path: [tableIdx], offset: 0 };

	let collapsedCaret: SelectionPoint | null = null;
	await ctx.controller.commitMultiScope({
		scopes,
		snapshot,
		mutate: (scopeViews) => {
			// Row scopes own every row, so the column splices land in owned
			// arrays; raws rebuild on the owned chains after mutate.
			const ownedTable = scopeViews[0].node;
			const rowChanges = mutDeleteColumn(ownedTable, colIdx);

			const newColumnCount = metadataOf(ownedTable, 'table').columnCount;
			const targetCol = Math.min(colIdx, Math.max(0, newColumnCount - 1));
			collapsedCaret = { path: [tableIdx, 0, targetCol], offset: 0 };
			ctx.selection.collapse();

			return [{ op: 'noop' }, ...rowChanges];
		},
		// Event targets the TABLE — a column index is not a child path (parity
		// with table-context's column ops); colIdx rides in the detail.
		op: {
			kind: 'tableDeleteColumn',
			detail: { colIdx, crossBlock: true },
			eventPath: [tableIdx]
		},
		afterTick: caretRestore ? () => caretRestore(collapsedCaret) : undefined
	});
	return collapsedCaret;
}
