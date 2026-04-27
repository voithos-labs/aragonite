// In-place table CST mutations. Callers own the commit ceremony
// (commitContainer / commitMultiScope) and rebuildContainerRaw; these helpers
// touch neither reactivity, undo, nor raw.

import type {
	CstNode,
	TableMetadata,
	TableRowMetadata,
	TableAlignment
} from '../../../core/nodes';

const ALIGN_CYCLE: TableAlignment[] = ['left', 'center', 'right'];

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

// Unconditional mutators: they will happily delete the last row/column.
// Refusal (>=1 header + >=1 body row, >=1 column) is the wrapper's job.
// deleteRow promotes the next row to header status when the header is removed.
export function deleteRow(table: CstNode, rowIdx: number): void {
	const rows = table.children ?? [];
	const willRemoveHeader = rowIdx === 0;
	rows.splice(rowIdx, 1);
	if (willRemoveHeader && rows.length > 0) {
		(rows[0].metadata as TableRowMetadata).isHeader = true;
	}
}

export function deleteColumn(table: CstNode, colIdx: number): void {
	const meta = table.metadata as TableMetadata;
	for (const row of table.children ?? []) {
		row.children!.splice(colIdx, 1);
	}
	meta.alignments.splice(colIdx, 1);
	meta.columnCount -= 1;
}

export function cycleAlignment(table: CstNode, colIdx: number): void {
	const meta = table.metadata as TableMetadata;
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
