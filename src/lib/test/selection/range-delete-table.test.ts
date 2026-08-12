import { describe, it, expect, afterEach } from 'vitest';
import { rangeDelete } from '../../selection/range-delete';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { createSharingState } from '../../tree-operations/sharing';
import type { CstNode, Document, TableMetadata, TableRowMetadata } from '../../core/nodes';
import { expectDevWarns } from '$lib/test/support/warn-gate';

// rangeDelete is driven with hand-built endpoints, so the table arms see char offsets
// SelectionState would have snapped to cell coordinates first.
afterEach(() =>
	expectDevWarns([
		'deleteFromProseIntoTable:end',
		'deleteFromTableIntoProse:start',
		'deleteAcrossTwoTables:start',
		'deleteAcrossTwoTables:end'
	])
);

function findTable(doc: Document): CstNode | null {
	for (const child of doc.children) {
		if (child.kind === 'table') return child;
	}
	return null;
}

const TWO_COL_FOUR_ROW = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n';

// Cross-block table-END endpoints are whole-row-snapped before rangeDelete
// (table-endpoint-snap.ts), so end.offset is the INCLUSIVE last cell of its row and the delete
// clears [0, end.offset].
describe('rangeDelete — Case 1 (prose anchor → cell focus mid-table)', () => {
	it('clears cells [0..end] inclusive, removes fully-covered rows, promotes header', () => {
		// Doc: paragraph + 4-row table (header + 3 body rows)
		const source = `intro paragraph\n\n${TWO_COL_FOUR_ROW}`;
		const doc = parse(source);

		// end.offset = 2 (inclusive) → clears cells 0,1,2 (header row entirely, plus body row 1's
		// cell 0)
		const result = rangeDelete(
			doc,
			{ path: [0], offset: 5 },
			{ path: [1], offset: 2 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		const para = result.newDoc.children[0];
		expect(para.kind).toBe('paragraph');
		expect(para.raw.trimEnd()).toBe('intro');

		const table = findTable(result.newDoc)!;
		expect(table).toBeTruthy();
		// Header row covers cells 0,1 — fully in range — removed.
		// Row 1 (cells 2,3) — only cell 2 in range — survives, cell 0 cleared.
		expect(table.children).toHaveLength(3);
		expect((table.children![0].metadata as TableRowMetadata).isHeader).toBe(true);
		expect(table.children![0].children![0].raw).toBe('');
		expect(table.children![0].children![1].raw).toBe('2');
		expect(table.children![1].children![0].raw).toBe('3');

		expect(result.collapsedCaret).toEqual({ path: [0], offset: 5 });

		const serialized = serialize(result.newDoc);
		expect(serialized).toContain('| --- | --- |');
	});

	it('removes the table when the entire table is in range', () => {
		// 1-row, 2-col table; clear all 2 cells (inclusive last cell = 1).
		const source = 'before\n\n| A | B |\n| --- | --- |\n';
		const doc = parse(source);

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 6 },
			{ path: [1], offset: 1 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		expect(result.newDoc.children).toHaveLength(1);
		expect(result.newDoc.children[0].kind).toBe('paragraph');
	});

	it('drops blocks strictly between when paragraph then other block then table', () => {
		const source = `head\n\nmiddle\n\n${TWO_COL_FOUR_ROW}`;
		const doc = parse(source);

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 4 },
			{ path: [2], offset: 1 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		const survivors = result.newDoc.children;
		expect(survivors).toHaveLength(2);
		expect(survivors[0].kind).toBe('paragraph');
		const table = survivors[1];
		expect(table.kind).toBe('table');
		// Header row removed (cells 0,1 both in range, inclusive end = 1), row 1 promoted to header
		expect((table.children![0].metadata as TableRowMetadata).isHeader).toBe(true);
		expect(table.children![0].children![0].raw).toBe('1');
	});

	it('nested end table survives a deleted middle block: container raw rebuilds at the shifted path', () => {
		// para[0], middle[1], blockquote[2] wrapping the table. Deleting middle shifts the blockquote
		// to [1], so the ancestry rebuild must follow the surviving table, not the stale end path.
		const source = 'para\n\nmiddle\n\n> | A | B |\n> | --- | --- |\n> | 1 | 2 |\n';
		const doc = parse(source);

		// end.offset = 2 (inclusive) → clears cells 0,1,2: header row removed, body promoted.
		const result = rangeDelete(
			doc,
			{ path: [0], offset: 2 },
			{ path: [2, 0], offset: 2 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		const survivors = result.newDoc.children;
		expect(survivors).toHaveLength(2);
		expect(survivors[0].raw.trimEnd()).toBe('pa');
		const blockquote = survivors[1];
		expect(blockquote.kind).toBe('blockquote');
		const table = blockquote.children![0];
		expect(table.kind).toBe('table');
		expect(table.children).toHaveLength(1);
		expect(table.children![0].children![0].raw).toBe('');
		expect(table.children![0].children![1].raw).toBe('2');
		// Blockquote raw must be rebuilt from the surviving table, not left stale.
		expect(blockquote.raw).not.toContain('A');
		expect(serialize(result.newDoc)).not.toContain('| A | B |');
	});
});

describe('rangeDelete — Case 2 (cell anchor mid-table → prose focus below)', () => {
	it('clears cells [start..lastCell] in start row, removes rows below, header unchanged', () => {
		// Anchor at cell 3 (row 1, col 1) clears cells 3..end: body rows 2 (4,5) and 3 (6,7) are
		// fully in range and removed, while row 1 keeps col 0.
		const source = `${TWO_COL_FOUR_ROW}\nfollow paragraph\n`;
		const doc = parse(source);

		// Focus 7 chars in: 'follow ' | 'paragraph'. Drops the 7-char head.
		const result = rangeDelete(
			doc,
			{ path: [0], offset: 3 },
			{ path: [1], offset: 7 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		const survivors = result.newDoc.children;
		expect(survivors).toHaveLength(2);
		const table = survivors[0];
		expect(table.kind).toBe('table');
		expect(table.children).toHaveLength(2);
		expect((table.children![0].metadata as TableRowMetadata).isHeader).toBe(true);
		expect(table.children![0].children![0].raw).toBe('A');
		expect(table.children![0].children![1].raw).toBe('B');
		expect(table.children![1].children![0].raw).toBe('1');
		expect(table.children![1].children![1].raw).toBe('');

		// Surviving paragraph head should be 'paragraph' (offset 6 = after 'follow ')
		const para = survivors[1];
		expect(para.kind).toBe('paragraph');
		expect(para.raw.trimEnd()).toBe('paragraph');
	});

	it('removes the table when start.offset = 0 (entire table in range)', () => {
		const source = `${TWO_COL_FOUR_ROW}\nafter\n`;
		const doc = parse(source);

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 0 },
			{ path: [1], offset: 0 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		expect(result.newDoc.children).toHaveLength(1);
		expect(result.newDoc.children[0].kind).toBe('paragraph');
		expect(result.newDoc.children[0].raw.trimEnd()).toBe('after');
		expect(result.collapsedCaret).toEqual({ path: [0], offset: 0 });
	});

	it('table fully consumed into a nested tail: caret addresses the tail at its post-delete path', () => {
		// Anchor cell 0 → mid-"second": the table empties AND the blockquote's first paragraph is
		// deleted, so the surviving tail shifts at both depths — [1, 1] becomes [0, 0].
		const source = `${TWO_COL_FOUR_ROW}\n> first\n>\n> second\n`;
		const doc = parse(source);

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 0 },
			{ path: [1, 1], offset: 3 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		const survivors = result.newDoc.children;
		expect(survivors).toHaveLength(1);
		expect(survivors[0].kind).toBe('blockquote');
		expect(survivors[0].children).toHaveLength(1);
		expect(survivors[0].children![0].raw.trimEnd()).toBe('ond');
		// Blockquote raw must be rebuilt from the surviving child, not left stale.
		expect(survivors[0].raw).not.toContain('first');
		expect(result.collapsedCaret).toEqual({ path: [0, 0], offset: 0 });
	});
});

describe('rangeDelete — Case 3 (prose → table → prose, full-table span)', () => {
	it('merges anchor and focus paragraphs, table fully consumed', () => {
		const source = `head text\n\n${TWO_COL_FOUR_ROW}\ntail text\n`;
		const doc = parse(source);

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 4 },
			{ path: [2], offset: 4 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		// head + tail merge: 'head' + ' text' = 'head text\n'
		expect(result.newDoc.children).toHaveLength(1);
		expect(result.newDoc.children[0].kind).toBe('paragraph');
		expect(result.newDoc.children[0].raw).toBe('head text\n');
	});
});

describe('rangeDelete — intra-table rectangular (same-path)', () => {
	it('Ctrl+A 2nd press: clears every cell, preserves structure and alignments', () => {
		const source = '| L | C | R |\n| :--- | :---: | ---: |\n| a | b | c |\n| d | e | f |\n';
		const doc = parse(source);

		const tableBefore = doc.children[0];
		const lastCellIdx =
			tableBefore.children!.length * (tableBefore.metadata as TableMetadata).columnCount - 1;

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 0 },
			{ path: [0], offset: lastCellIdx },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		const table = result.newDoc.children[0];
		expect(table.kind).toBe('table');
		expect(table.children).toHaveLength(3);
		expect((table.metadata as TableMetadata).alignments).toEqual(['left', 'center', 'right']);
		for (const row of table.children!) {
			for (const cell of row.children!) {
				expect(cell.raw).toBe('');
			}
		}
		expect((table.children![0].metadata as TableRowMetadata).isHeader).toBe(true);
		// Caret lands inside the anchor cell's contenteditable, not the table wrapper.
		expect(result.collapsedCaret).toEqual({ path: [0, 0, 0], offset: 0 });
	});

	it('partial rectangular clear leaves out-of-rect cells untouched', () => {
		// 2-col, 4-row table. Anchor cell 2 (row 1, col 0), focus cell 5 (row 2, col 1).
		// Rectangle spans rows 1..2 cols 0..1 — clears all 4 cells in that rect.
		const source = TWO_COL_FOUR_ROW;
		const doc = parse(source);

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 2 },
			{ path: [0], offset: 5 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		const table = result.newDoc.children[0];
		expect(table.children).toHaveLength(4);
		expect(table.children![0].children![0].raw).toBe('A');
		expect(table.children![0].children![1].raw).toBe('B');
		expect(table.children![1].children![0].raw).toBe('');
		expect(table.children![1].children![1].raw).toBe('');
		expect(table.children![2].children![0].raw).toBe('');
		expect(table.children![2].children![1].raw).toBe('');
		expect(table.children![3].children![0].raw).toBe('5');
		expect(table.children![3].children![1].raw).toBe('6');
		// Anchor at cell 2 = row 1, col 0 — caret deep-paths into that cell.
		expect(result.collapsedCaret).toEqual({ path: [0, 1, 0], offset: 0 });
	});

	it('column-only rectangle clears just the targeted column', () => {
		// 2-col, 4-row. Anchor cell 1 (row 0 col 1), focus cell 7 (row 3 col 1).
		// Rectangle = column 1 across all rows — clears the right column only.
		const source = TWO_COL_FOUR_ROW;
		const doc = parse(source);

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 1 },
			{ path: [0], offset: 7 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		const table = result.newDoc.children[0];
		expect(table.children).toHaveLength(4);
		for (const row of table.children!) {
			expect(row.children![1].raw).toBe('');
		}
		expect(table.children![0].children![0].raw).toBe('A');
		expect(table.children![3].children![0].raw).toBe('5');
		// Anchor at cell 1 = row 0, col 1.
		expect(result.collapsedCaret).toEqual({ path: [0, 0, 1], offset: 0 });
	});
});

describe('rangeDelete — table edge cases', () => {
	it('Case 1 with end at the last cell removes the entire table', () => {
		const source = `head\n\n${TWO_COL_FOUR_ROW}`;
		const doc = parse(source);
		const lastCellIdx = 2 * 4 - 1;

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 2 },
			{ path: [1], offset: lastCellIdx },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		expect(result.newDoc.children).toHaveLength(1);
		expect(result.newDoc.children[0].kind).toBe('paragraph');
		expect(result.newDoc.children[0].raw.trimEnd()).toBe('he');
	});

	it('Case 2: partial last row (start.offset mid-row) clears trailing cells of that row', () => {
		// 3-col, 3-row table. Anchor at cell 4 (row 1, col 1), focus into paragraph.
		// Cells 4..end (5,6,7,8) cleared. Row 1: col 0 stays, col 1+2 cleared. Rows 2 fully removed.
		const source = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n\nafter\n';
		const doc = parse(source);

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 4 },
			{ path: [1], offset: 0 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		const table = result.newDoc.children[0];
		expect(table.children).toHaveLength(2);
		expect((table.children![0].metadata as TableRowMetadata).isHeader).toBe(true);
		expect(table.children![1].children![0].raw).toBe('1');
		expect(table.children![1].children![1].raw).toBe('');
		expect(table.children![1].children![2].raw).toBe('');
	});
});
