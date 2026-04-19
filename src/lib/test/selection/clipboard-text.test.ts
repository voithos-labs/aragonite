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

	it('collects text across two list items (container paths)', () => {
		// Previous coverage exercised top-level paragraph paths only. A regression
		// in path-walking for list-item descent (wrong trivia, wrong ancestor
		// traversal) would produce mangled text but go undetected. This test
		// exercises a path like [0, 0, 0] → [0, 1, 0].
		const doc = parse('- first\n- second\n');
		const text = collectCrossBlockText(
			doc,
			{ path: [0, 0, 0], offset: 1 }, // mid "first" inside item 0's paragraph
			{ path: [0, 1, 0], offset: 3 } // mid "second" inside item 1's paragraph
		);
		expect(text).toContain('irst');
		expect(text).toContain('sec');
		// A blank-line join is not expected between adjacent tight list items,
		// but the two item contents MUST both appear — a walker that bailed at
		// the first nested container would only return one of them.
	});

	it('collects text across a blockquote and a following paragraph', () => {
		// Container start, top-level end — forces the walker to ascend out of
		// the blockquote before walking across siblings.
		const doc = parse('> inside\n\nafter\n');
		const text = collectCrossBlockText(
			doc,
			{ path: [0, 0], offset: 0 }, // start of paragraph inside blockquote
			{ path: [1], offset: 5 } // end of "after"
		);
		expect(text).toContain('inside');
		expect(text).toContain('after');
	});
});
