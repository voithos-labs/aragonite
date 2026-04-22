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
});
