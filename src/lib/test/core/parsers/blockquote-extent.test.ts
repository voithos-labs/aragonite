import { describe, expect, it } from 'vitest';
import { splitLines } from '$lib/core/lines';
import { blockquoteExtent } from '$lib/core/parsers/blockquote';

// The extent must agree with the full parse on where the quote ends, CommonMark §5.1 lazy
// continuation included, or an opener that decomposes its own body lands on the wrong line.

const scan = (src: string) => {
	const lines = splitLines(src);
	return blockquoteExtent(lines, 0, lines.length);
};

describe('blockquoteExtent', () => {
	it('returns the byte-exact raw and the index past consecutive quote lines', () => {
		const { raw, nextIndex } = scan('> a\n> b\n');
		expect(raw).toBe('> a\n> b\n');
		expect(nextIndex).toBe(2);
	});

	it('carries a lazy-continuation line (no `>`) into the extent, then stops at the blank', () => {
		const { raw, nextIndex } = scan('> quoted\nlazy tail\n\nafter\n');
		expect(raw).toBe('> quoted\nlazy tail\n');
		expect(nextIndex).toBe(2);
	});

	it('stops at a blank line, which closes the open paragraph', () => {
		const { raw, nextIndex } = scan('> quoted\n\n> separate\n');
		expect(raw).toBe('> quoted\n');
		expect(nextIndex).toBe(1);
	});

	it('preserves CRLF endings in the returned raw', () => {
		const { raw } = scan('> a\r\n> b\r\n');
		expect(raw).toBe('> a\r\n> b\r\n');
	});
});
