import { describe, it, expect } from 'vitest';
import { collectCrossBlockText } from '../../selection/clipboard-text';
import type { SelectionPoint } from '../../selection/primitives';
import { parse } from '../../core/parser';

describe('collectCrossBlockText', () => {
	it('preserves blank line between two top-level paragraphs', () => {
		const doc = parse('first\n\nsecond\n');
		const text = collectCrossBlockText(doc, { path: [0], offset: 0 }, { path: [1], offset: 6 });
		expect(text).toBe('first\n\nsecond');
	});

	it('preserves blank lines between three paragraphs with partial endpoints', () => {
		const doc = parse('abc\n\ndef\n\nghi\n');
		const text = collectCrossBlockText(doc, { path: [0], offset: 1 }, { path: [2], offset: 2 });
		expect(text).toBe('bc\n\ndef\n\ngh');
	});

	it('preserves blank line when end block is the immediate next sibling', () => {
		const doc = parse('aa\n\nbb\n');
		const text = collectCrossBlockText(doc, { path: [0], offset: 1 }, { path: [1], offset: 1 });
		expect(text).toBe('a\n\nb');
	});

	it('collects text across two list items (container paths)', () => {
		const doc = parse('- first\n- second\n');
		const text = collectCrossBlockText(
			doc,
			{ path: [0, 0, 0], offset: 1 },
			{ path: [0, 1, 0], offset: 3 }
		);
		expect(text).toContain('irst');
		expect(text).toContain('sec');
	});

	it('collects text across a blockquote and a following paragraph', () => {
		const doc = parse('> inside\n\nafter\n');
		const text = collectCrossBlockText(doc, { path: [0, 0], offset: 0 }, { path: [1], offset: 5 });
		expect(text).toContain('inside');
		expect(text).toContain('after');
	});

	// Cross-block table endpoints snap to whole rows (table-endpoint-snap.ts), so the clipboard
	// captures the same rows the highlight paints and the delete clears; the offset is a cell index.
	describe('through tables', () => {
		// 3 columns × (header + 2 body rows). Cell indices: header 0..2, row 1 = 3..5, row 2 = 6..8. A
		// mid-row endpoint (e.g. cell 4) lets the snap show: a partial row is pulled to the whole row.
		const fixture =
			'Before.\n\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n\nAfter.\n';
		const tableRaw = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';
		const cell = (offset: number): SelectionPoint => ({ path: [1], offset, cellCoordinate: true });

		it('emits full table.raw when selection spans the whole table', () => {
			const doc = parse(fixture);
			const text = collectCrossBlockText(doc, { path: [0], offset: 0 }, { path: [2], offset: 6 });
			expect(text).toBe(`Before.\n\n${tableRaw}\nAfter.`);
		});

		it('table-as-start: snaps the anchor cell up to its whole row, then to table end', () => {
			// Anchor in cell 4 (row 1, col 1) → snaps down to row-start (cell 3); emits
			// whole rows 1..2, not a col-1..2 sub-rectangle.
			const doc = parse(fixture);
			const text = collectCrossBlockText(doc, cell(4), { path: [2], offset: 6 });
			expect(text).toBe('| 1 | 2 | 3 |\n| --- | --- | --- |\n| 4 | 5 | 6 |\n\nAfter.');
		});

		it('table-as-end: snaps the focus cell to its whole row so the row is fully captured', () => {
			// Focus in cell 4 (row 1) → snaps up to the row's last cell, emitting whole rows 0..1
			// including cells the user did not drag across. Pre-snap this dropped row 1 entirely.
			const doc = parse(fixture);
			const text = collectCrossBlockText(doc, { path: [0], offset: 0 }, cell(4));
			expect(text).toBe('Before.\n\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n');
		});

		it('intra-table same-path selection is NOT snapped — sub-rectangle band preserved', () => {
			// Both endpoints on the same table: rectangular sub-cell copy stays, the
			// row-band rounding is the existing intra-table behavior, untouched by snap.
			const doc = parse(fixture);
			const text = collectCrossBlockText(doc, cell(1), cell(4));
			expect(text).toBe('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n');
		});

		it('returns empty string when both endpoints share a zero-length table portion', () => {
			const doc = parse(fixture);
			const text = collectCrossBlockText(doc, cell(4), cell(4));
			expect(text).toBe('');
		});

		it('keeps the focus cell row when the intra-table focus lands on a row-start cell (E-F5)', () => {
			// Anchor cell 0 (row 0, col 0), focus cell 3 (row 1, col 0). The end cell is
			// inclusive — its row must be captured; an exclusive end drops row 1.
			const doc = parse(fixture);
			const text = collectCrossBlockText(doc, cell(0), cell(3));
			expect(text).toBe('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n');
		});

		it('emits each table fully when selection spans two tables and surrounding paragraphs', () => {
			const doc = parse(
				'a\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nb\n\n| C | D |\n| --- | --- |\n| 3 | 4 |\n\nc\n'
			);
			const text = collectCrossBlockText(doc, { path: [0], offset: 0 }, { path: [4], offset: 1 });
			expect(text).toBe(
				'a\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nb\n\n| C | D |\n| --- | --- |\n| 3 | 4 |\n\nc'
			);
		});
	});
});
