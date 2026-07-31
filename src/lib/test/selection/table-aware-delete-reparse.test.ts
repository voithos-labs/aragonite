// A cross-block delete from prose INTO a table leaves two ADJACENT blocks. A table opens only on
// the first line of a paragraph block (core/parsers/paragraph.ts), so a truncated head that does
// not end on a line ending lets the next parse swallow the table into the paragraph — the CST
// looks correct and the loss lands on reload. Its sibling truncation in range-delete-chrome.ts
// terminates the head first: the N−1-of-N shape culture.md § sibling-path parity names.
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { tableAwareRangeDelete } from '../../selection/range-delete-table';
import { createSharingState } from '../../tree-operations/sharing';
import type { CellSelectionPoint, SelectionPoint } from '../../selection/primitives';

// Paragraph at [0], 3-row table at [1] (header + two body rows), blank line between.
const PROSE_THEN_TABLE = 'intro text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
const TABLE_THEN_PROSE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nafter text\n';

/** Row-major cell index on the table block's own path. */
const cell = (path: number[], index: number): CellSelectionPoint => ({
	path,
	offset: index,
	cellCoordinate: true
});

function deletedBytes(source: string, start: SelectionPoint, end: SelectionPoint): string {
	const doc = parse(source);
	return serialize(tableAwareRangeDelete(doc, start, end, createSharingState(), undefined).newDoc);
}

/** The block kinds the delete's own output parses back to. */
function reparsedKinds(bytes: string): string[] {
	return parse(bytes).children.map((child) => child.kind);
}

describe('a prose→table delete leaves bytes the parser still reads as a table', () => {
	it('keeps the paragraph and the table separate when the head truncates mid-line', () => {
		const bytes = deletedBytes(PROSE_THEN_TABLE, { path: [0], offset: 5 }, cell([1], 1));

		expect(bytes).toBe('intro\n\n| 1 | 2 |\n| --- | --- |\n| 3 | 4 |\n');
		expect(reparsedKinds(bytes)).toEqual(['paragraph', 'table']);
	});

	it('keeps them separate when the head truncates at the paragraph’s last byte', () => {
		// The head is a whole line already, so only its missing terminator differs
		// from the case above — the narrowest form of the same loss.
		const bytes = deletedBytes(PROSE_THEN_TABLE, { path: [0], offset: 10 }, cell([1], 1));

		expect(reparsedKinds(bytes)).toEqual(['paragraph', 'table']);
	});

	it('leaves the surviving paragraph line-terminated when the table is consumed whole', () => {
		// Same truncation, no table left to separate from — so the loss shows as a
		// document that no longer ends on a line ending.
		const bytes = deletedBytes(PROSE_THEN_TABLE, { path: [0], offset: 5 }, cell([1], 5));

		expect(bytes).toBe('intro\n');
	});

	// Non-vacuity: reparse equality is not automatic, and the opposite direction already separates —
	// so the assertion above measures block separation, not "any delete output reparses".
	it('the reverse direction, table→prose, was already separable', () => {
		const bytes = deletedBytes(TABLE_THEN_PROSE, cell([0], 3), { path: [1], offset: 5 });

		expect(reparsedKinds(bytes)).toEqual(['table', 'paragraph']);
	});
});
