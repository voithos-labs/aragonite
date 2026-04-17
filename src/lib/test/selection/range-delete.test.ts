import { describe, it, expect } from 'vitest';
import { rangeDelete } from '../../selection/range-delete';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';

function run(source: string, start: { path: number[]; offset: number }, end: { path: number[]; offset: number }) {
	const doc = parse(source);
	const result = rangeDelete(doc, start, end);
	return { source: serialize(result.newDoc), caret: result.collapsedCaret };
}

describe('rangeDelete — same-container cases', () => {
	it('deletes a range within a single paragraph', () => {
		const { source, caret } = run(
			'abcdef\n',
			{ path: [0], offset: 1 },
			{ path: [0], offset: 4 }
		);
		expect(source).toBe('aef\n');
		expect(caret).toEqual({ path: [0], offset: 1 });
	});

	it('merges two adjacent top-level paragraphs at an interior offset', () => {
		const { source, caret } = run(
			'hello world\n\nfoo bar\n',
			{ path: [0], offset: 6 },
			{ path: [1], offset: 4 }
		);
		expect(source).toBe('hello bar\n');
		expect(caret).toEqual({ path: [0], offset: 6 });
	});

	it('deletes middle blocks between two top-level endpoints', () => {
		const { source } = run(
			'aaa\n\nbbb\n\nccc\n\nddd\n',
			{ path: [0], offset: 2 },
			{ path: [3], offset: 1 }
		);
		expect(source).toBe('aadd\n');
	});
});

describe('rangeDelete — cross-container start-wins', () => {
	it('start outside container, end inside blockquote: merges at top level, blockquote cleans up', () => {
		// The parser merges consecutive "> " lines into a single inner paragraph
		// with multi-line raw, so the second line lives at [1, 0] offset 19
		// (past "quote line 1\nquote "), not at a separate [1, 1] child.
		const { source, caret } = run(
			'before paragraph\n\n> quote line 1\n> quote line 2\n',
			{ path: [0], offset: 7 },
			{ path: [1, 0], offset: 19 }
		);
		expect(source).toBe('before line 2\n');
		expect(caret).toEqual({ path: [0], offset: 7 });
	});

	it('start inside blockquote, end outside: merges at start\'s position, blockquote survives', () => {
		const { source, caret } = run(
			'> inside quote line 1\n> inside quote line 2\n\nafter paragraph\n',
			{ path: [0, 0], offset: 7 },
			{ path: [1], offset: 6 }
		);
		expect(source).toBe('> inside paragraph\n');
		expect(caret).toEqual({ path: [0, 0], offset: 7 });
	});

	it('sibling-container collapse: two blockquotes merge into start\'s blockquote', () => {
		const { source } = run(
			'> first bq\n\nmiddle\n\n> second bq\n',
			{ path: [0, 0], offset: 6 },
			{ path: [2, 0], offset: 7 }
		);
		expect(source).toBe('> first bq\n');
	});
});

describe('rangeDelete — boundary offsets', () => {
	it('start.offset = 0 keeps empty head, re-parses as paragraph from endTail', () => {
		const { source } = run(
			'# heading text\n\nfollow paragraph\n',
			{ path: [0], offset: 0 },
			{ path: [1], offset: 7 }
		);
		// Heading marker consumed; result re-parses as paragraph.
		expect(source).toBe('paragraph\n');
	});

	it('end.offset at end of endBlock yields startHead only', () => {
		const { source } = run(
			'keep\n\ndelete\n',
			{ path: [0], offset: 4 },
			{ path: [1], offset: 6 }
		);
		expect(source).toBe('keep\n');
	});
});
