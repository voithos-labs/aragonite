// In-place table CST mutations; the caller owns the commit ceremony and the raw rebuild,
// so these touch neither reactivity, undo, nor raw. Column mutators emit exactly one
// StructuralChange per row, in row order, for multi-scope callers to pair with row scopes.

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

// Unconditional: refusal (>=1 header + >=1 body row, >=1 column) is the wrapper's job.
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

// The per-row cell permute keeps keyed cell identity (reorderChildren's idMap); the
// alignments splice must mirror that permutation exactly to stay in lockstep.
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
	// 'none' renders identically to 'left', so stepping through it would look like a stuck
	// press; jump to 'center' instead. Once cycling begins the column never re-enters it.
	if (current === 'none') {
		meta.alignments[colIdx] = 'center';
		return;
	}
	const idx = ALIGN_CYCLE.indexOf(current);
	meta.alignments[colIdx] = ALIGN_CYCLE[(idx + 1) % ALIGN_CYCLE.length];
}

// ── Delete-enablement predicates ─────────────────────────────────────────────
// Single source of truth for the deletion-refusal rules, here rather than in
// editor-actions/ so selection/ never has to reach across for them.

/**
 * Whether a row delete is allowed. `rowCount` is the FULL count including the header. A
 * header delete promotes the next row so it needs only a second row; a body delete needs
 * a second body row, else it would leave a header-only table.
 */
export function canDeleteRow(rowIdx: number, rowCount: number): boolean {
	if (rowCount <= 1) return false;
	return rowIdx === 0 || rowCount - 1 > 1;
}

/** Whether a column delete is allowed: a table must keep at least one column. */
export function canDeleteColumn(colCount: number): boolean {
	return colCount > 1;
}
