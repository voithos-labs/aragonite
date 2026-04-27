import { describe, it, expect } from 'vitest';
import { collectCrossBlockText } from '../../selection/clipboard-text';
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

	describe('through tables', () => {
		const fixture = 'Before.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter.\n';
		const tableRaw = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

		it('emits full table.raw when selection spans the whole table', () => {
			const doc = parse(fixture);
			const text = collectCrossBlockText(doc, { path: [0], offset: 0 }, { path: [2], offset: 6 });
			expect(text).toBe(`Before.\n\n${tableRaw}\nAfter.`);
		});

		it('emits sub-table from anchor cell when focus is in a following paragraph', () => {
			const doc = parse(fixture);
			const text = collectCrossBlockText(doc, { path: [1], offset: 2 }, { path: [2], offset: 6 });
			expect(text).toBe('| 1 | 2 |\n| --- | --- |\n\nAfter.');
		});

		it('emits sub-table up to focus cell when anchor is in a preceding paragraph', () => {
			const doc = parse(fixture);
			const text = collectCrossBlockText(doc, { path: [0], offset: 0 }, { path: [1], offset: 2 });
			expect(text).toBe('Before.\n\n| A | B |\n| --- | --- |\n');
		});

		it('emits sub-table for row band when both endpoints are inside the same table', () => {
			const doc = parse(fixture);
			const text = collectCrossBlockText(doc, { path: [1], offset: 1 }, { path: [1], offset: 3 });
			expect(text).toBe(tableRaw);
		});

		it('returns empty string when both endpoints share a zero-length table portion', () => {
			const doc = parse(fixture);
			const text = collectCrossBlockText(doc, { path: [1], offset: 2 }, { path: [1], offset: 2 });
			expect(text).toBe('');
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
