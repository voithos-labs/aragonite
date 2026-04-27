// In-place table CST mutations. Callers own the commit ceremony
// (commitContainer / commitMultiScope) and rebuildContainerRaw; these helpers
// touch neither reactivity, undo, nor raw.

import type {
	CstNode,
	TableMetadata,
	TableRowMetadata,
	TableAlignment
} from '../../../core/nodes';

const ALIGN_CYCLE: TableAlignment[] = ['none', 'left', 'center', 'right'];

// ── Public API ─────────────────────────────────────────────────────────────

export function insertEmptyRow(
	table: CstNode,
	rowIdx: number,
	side: 'above' | 'below'
): void {
	const meta = table.metadata as TableMetadata;
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
): void {
	const meta = table.metadata as TableMetadata;
	const insertAt = side === 'left' ? colIdx : colIdx + 1;
	for (const row of table.children ?? []) {
		row.children!.splice(insertAt, 0, {
			kind: 'tableCell',
			leadingTrivia: '',
			raw: ''
		});
	}
	meta.alignments.splice(insertAt, 0, 'none');
	meta.columnCount += 1;
}

// Refuses to remove the last row, and refuses to remove a body row when only
// one body row remains — the table would collapse to header-only and lose its
// utility. Removing the header promotes the next row.
export function deleteRow(table: CstNode, rowIdx: number): boolean {
	const rows = table.children ?? [];
	if (rows.length <= 1) return false;
	const willRemoveHeader = rowIdx === 0;
	const bodyCount = rows.length - 1;
	if (!willRemoveHeader && bodyCount <= 1) return false;
	rows.splice(rowIdx, 1);
	if (willRemoveHeader && rows.length > 0) {
		(rows[0].metadata as TableRowMetadata).isHeader = true;
	}
	return true;
}

export function deleteColumn(table: CstNode, colIdx: number): boolean {
	const meta = table.metadata as TableMetadata;
	if (meta.columnCount <= 1) return false;
	for (const row of table.children ?? []) {
		row.children!.splice(colIdx, 1);
	}
	meta.alignments.splice(colIdx, 1);
	meta.columnCount -= 1;
	return true;
}

export function cycleAlignment(table: CstNode, colIdx: number): void {
	const meta = table.metadata as TableMetadata;
	const idx = ALIGN_CYCLE.indexOf(meta.alignments[colIdx]);
	meta.alignments[colIdx] = ALIGN_CYCLE[(idx + 1) % ALIGN_CYCLE.length];
}
