import { describe, it, expect } from 'vitest';
import { parseInline } from '#lib';

describe('raw HTML (CommonMark §6.6), each form read from its `<`', () => {
	/** The length of the raw HTML node starting at `pos`, or null when none starts there. */
	function match(raw: string, pos = 0, end = raw.length): number | null {
		const node = parseInline(raw, pos, end)[0];
		return node?.kind === 'rawHtml' ? node.end - node.start : null;
	}

	it('rejects an unterminated open tag', () => {
		expect(match('<span no end')).toBeNull();
	});

	it('rejects an unterminated PI', () => {
		expect(match('<?xml')).toBeNull();
	});

	it('requires ASCII letter after <!', () => {
		expect(match('<!1>')).toBeNull();
	});

	it('is case-sensitive for CDATA', () => {
		expect(match('<![cdata[ x ]]>')).toBeNull();
	});

	describe('non-matches', () => {
		it('returns null for plain text', () => {
			expect(match('hello')).toBeNull();
		});
		it('returns null when pos does not point at <', () => {
			expect(match('x<span>', 0)).toBeNull();
		});
		it('returns null for lone <', () => {
			expect(match('<')).toBeNull();
		});
	});

	it('matches at non-zero pos', () => {
		const raw = 'hello <span> world';
		expect(match(raw, 6)).toBe(6);
	});
});
