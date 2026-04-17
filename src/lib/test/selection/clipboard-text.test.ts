import { describe, it, expect } from 'vitest';
import { collectCrossBlockText } from '../../selection/clipboard-text';
import { parse } from '../../core/parser';

describe('collectCrossBlockText', () => {
	it('preserves blank line between two top-level paragraphs', () => {
		const doc = parse('first\n\nsecond\n');
		const text = collectCrossBlockText(
			doc,
			{ path: [0], offset: 0 },
			{ path: [1], offset: 6 } // end of "second"
		);
		expect(text).toBe('first\n\nsecond');
	});

	it('preserves blank lines between three paragraphs with partial endpoints', () => {
		const doc = parse('abc\n\ndef\n\nghi\n');
		const text = collectCrossBlockText(
			doc,
			{ path: [0], offset: 1 }, // mid "abc"
			{ path: [2], offset: 2 } // mid "ghi"
		);
		expect(text).toBe('bc\n\ndef\n\ngh');
	});

	it('preserves blank line when end block is the immediate next sibling', () => {
		const doc = parse('aa\n\nbb\n');
		const text = collectCrossBlockText(
			doc,
			{ path: [0], offset: 1 }, // after "a"
			{ path: [1], offset: 1 } // after "b"
		);
		expect(text).toBe('a\n\nb');
	});
});
