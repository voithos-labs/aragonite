// In-place table CST mutations. Callers own the commit ceremony
// (commitContainer / commitMultiScope) and rebuildContainerRaw; these helpers
// touch neither reactivity, undo, nor raw. Column mutators emit exactly one
// StructuralChange per row, in row order — multi-scope callers pair them with
// their row scopes, and the ceremony arity-checks the pairing.

import type { CstNode, TableRowMetadata, TableAlignment } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import { reorderChildren } from './reorder';
import type { StructuralChange } from './structural-change';

const ALIGN_CYCLE: TableAlignment[] = ['left', 'center', 'right'];

// ── Public API ─────────────────────────────────────────────────────────────

export function insertEmptyRow(table: CstNode, rowIdx: number, side: 'above' | 'below'): void {
	const meta = metadataOf(table, 'table');
	const newRow: CstNode = {
		kind: 'tableRow',
		leadingTrivia: '',
		raw: '',
		metadata: { isHeader: false } satisfies TableRowMetadata,
		children: Array.from({ length: meta.columnCount }, () => ({
			kind: 'tableCell',
			leadingTrivia: '',
			raw: ''
		}))
	};
	const insertAt = side === 'above' ? rowIdx : rowIdx + 1;
	table.children!.splice(insertAt, 0, newRow);
}

export function insertEmptyColumn(
	table: CstNode,
	colIdx: number,
	side: 'left' | 'right'
): StructuralChange[] {
	const meta = metadataOf(table, 'table');
	const insertAt = side === 'left' ? colIdx : colIdx + 1;
	const changes: StructuralChange[] = [];
	for (const row of table.children ?? []) {
		row.children!.splice(insertAt, 0, { kind: 'tableCell', leadingTrivia: '', raw: '' });
		changes.push({ op: 'insert', at: insertAt, count: 1 });
	}
	meta.alignments.splice(insertAt, 0, 'none');
	meta.columnCount += 1;
	return changes;
}

// Unconditional mutators: they will happily delete the last row/column.
// Refusal (>=1 header + >=1 body row, >=1 column) is the wrapper's job.
// deleteRow promotes the next row to header status when the header is removed.
export function deleteRow(table: CstNode, rowIdx: number): void {
	const rows = table.children ?? [];
	const willRemoveHeader = rowIdx === 0;
	rows.splice(rowIdx, 1);
	if (willRemoveHeader && rows.length > 0) {
		metadataOf(rows[0], 'tableRow').isHeader = true;
	}
}

export function deleteColumn(table: CstNode, colIdx: number): StructuralChange[] {
	const meta = metadataOf(table, 'table');
	const changes: StructuralChange[] = [];
	for (const row of table.children ?? []) {
		row.children!.splice(colIdx, 1);
		changes.push({ op: 'delete', at: colIdx, count: 1 });
	}
	meta.alignments.splice(colIdx, 1);
	meta.columnCount -= 1;
	return changes;
}

// Per-row cell permute keeps keyed cell identity (reorderChildren's idMap);
// the alignments splice mirrors that permutation byte-for-byte so the two stay
// in lockstep for any from/to. columnCount is untouched — a move adds no column.
export function moveColumn(table: CstNode, fromCol: number, toCol: number): StructuralChange[] {
	const meta = metadataOf(table, 'table');
	const changes: StructuralChange[] = [];
	for (const row of table.children ?? []) {
		changes.push(reorderChildren(row.children!, fromCol, toCol));
	}
	if (fromCol !== toCol) {
		const [moved] = meta.alignments.splice(fromCol, 1);
		meta.alignments.splice(toCol, 0, moved);
	}
	return changes;
}

export function setAlignment(table: CstNode, colIdx: number, alignment: TableAlignment): void {
	metadataOf(table, 'table').alignments[colIdx] = alignment;
}

export function cycleAlignment(table: CstNode, colIdx: number): void {
	const meta = metadataOf(table, 'table');
	const current = meta.alignments[colIdx];
	// 'none' renders identically to 'left' (no text-align override), so stepping
	// through it would look like a stuck press. From 'none' jump straight to
	// 'center'; once cycling begins the column never re-enters 'none'.
	if (current === 'none') {
		meta.alignments[colIdx] = 'center';
		return;
	}
	const idx = ALIGN_CYCLE.indexOf(current);
	meta.alignments[colIdx] = ALIGN_CYCLE[(idx + 1) % ALIGN_CYCLE.length];
}

// ── Delete-enablement predicates ─────────────────────────────────────────────
// Single source of truth for the deletion-refusal rules, shared by the action
// menu, the commit wrappers (editor-actions/table-context), and the
// selection-layer coverage delete (selection/range-delete-table-coverage). They
// live here — the layer all three import — so selection/ never reaches into
// editor-actions/ for them.

/**
 * Whether a row delete is allowed. rowCount is the FULL row count (header at
 * index 0 + body rows). A header delete promotes the next row, so it only needs
 * a second row; a body delete needs a second body row, else the last body row
 * would leave a header-only table.
 */
export function canDeleteRow(rowIdx: number, rowCount: number): boolean {
	if (rowCount <= 1) return false;
	return rowIdx === 0 || rowCount - 1 > 1;
}

/** Whether a column delete is allowed: a table must keep at least one column. */
export function canDeleteColumn(colCount: number): boolean {
	return colCount > 1;
}
