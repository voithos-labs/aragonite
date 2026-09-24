// In-place table CST mutations; the caller owns the commit and the raw rebuild, so these
// touch neither reactivity, undo, nor raw. Column mutators emit exactly one
// StructuralChange per row, in row order, for multi-scope callers to pair with row scopes.

import type { CstNode, TableRowMetadata, TableAlignment } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import { reorderChildren } from './reorder';
import { generateBlockId } from '../block-id';
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
	if (willRemoveHeader && rows.length > 0) promoteFirstRowToHeader(table);
}

/**
 * Make the table's first row its header. A header wider than the delimiter row is no table at
 * all, so the row's surplus cells become columns: the table widens, and every row takes its own
 * surplus into the new columns first, as a reload of the widened table reads it.
 */
export function promoteFirstRowToHeader(table: CstNode): void {
	const rows = table.children ?? [];
	if (rows.length === 0) return;
	const meta = metadataOf(table, 'table');
	const extra = metadataOf(rows[0], 'tableRow').surplusCells?.length ?? 0;
	if (extra > 0) {
		meta.columnCount += extra;
		meta.alignments = [...meta.alignments, ...Array<TableAlignment>(extra).fill('none')];
	}
	// Written as copies: only the table is this edit's own, and a row can still be in an undo entry.
	for (let i = 0; i < rows.length; i++) {
		if (i === 0 || extra > 0) rows[i] = widenedRow(rows[i], meta.columnCount, i === 0);
	}
}

/** A copy of the row holding `columnCount` cells, the missing ones taken from its surplus first. */
function widenedRow(row: CstNode, columnCount: number, isHeader: boolean): CstNode {
	const surplus = metadataOf(row, 'tableRow').surplusCells ?? [];
	const missing = Math.max(0, columnCount - row.children!.length);
	const added = Array.from({ length: missing }, (_, k): CstNode => ({
		kind: 'tableCell',
		leadingTrivia: '',
		raw: surplus[k] ?? ''
	}));
	const rest = surplus.slice(missing);
	const metadata: TableRowMetadata =
		rest.length > 0 ? { isHeader, surplusCells: rest } : { isHeader };
	const copy = { ...row, metadata, children: [...row.children!, ...added] } as CstNode;
	if (row.childIds) copy.childIds = [...row.childIds, ...added.map(() => generateBlockId())];
	delete copy.childSpans;
	return copy;
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
	// 'none' renders identically to 'left', so stepping through it would look like the click
	// did nothing; jump to 'center' instead. Once cycling begins the column never re-enters it.
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
 * Whether a row delete is allowed. `rowCount` is the full count including the header. A
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
