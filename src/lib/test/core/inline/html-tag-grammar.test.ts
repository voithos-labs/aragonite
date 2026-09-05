import { describe, it, expect } from 'vitest';
import { matchHtmlFormAt, type HtmlFormKind } from '../../../core/inline/html-tag-grammar';

describe('matchHtmlFormAt — per-form detection at position', () => {
	function match(raw: string, pos = 0): { kind: HtmlFormKind; length: number } | null {
		return matchHtmlFormAt(raw, pos, raw.length);
	}

	describe('open tag', () => {
		it('matches <span>', () => {
			expect(match('<span>')).toEqual({ kind: 'openTag', length: 6 });
		});
		it('matches with attributes', () => {
			expect(match('<span class="x">')).toEqual({ kind: 'openTag', length: 16 });
		});
		it('matches with unquoted attribute', () => {
			expect(match('<span class=x>')).toEqual({ kind: 'openTag', length: 14 });
		});
		it('matches self-closing', () => {
			expect(match('<br/>')).toEqual({ kind: 'openTag', length: 5 });
		});
		it('matches self-closing with space', () => {
			expect(match('<br />')).toEqual({ kind: 'openTag', length: 6 });
		});
		it('matches hyphenated tag name', () => {
			expect(match('<custom-element>')).toEqual({ kind: 'openTag', length: 16 });
		});
		it('matches an attribute on the next line', () => {
			expect(match('<span\nclass="y">')).toEqual({ kind: 'openTag', length: 16 });
		});
		it('rejects an unterminated open tag', () => {
			expect(match('<span no end')).toBeNull();
		});
	});

	describe('close tag', () => {
		it('matches </span>', () => {
			expect(match('</span>')).toEqual({ kind: 'closeTag', length: 7 });
		});
		it('matches with whitespace before >', () => {
			expect(match('</span >')).toEqual({ kind: 'closeTag', length: 8 });
		});
	});

	describe('comment', () => {
		it('matches inline comment', () => {
			expect(match('<!-- hi -->')).toEqual({ kind: 'comment', length: 11 });
		});
		it('matches multi-line comment via lookahead', () => {
			const raw = '<!--\nfoo\n-->';
			expect(match(raw)).toEqual({ kind: 'comment', length: raw.length });
		});
		it('rejects unterminated comment', () => {
			expect(match('<!-- no end')).toBeNull();
		});
	});

	describe('processing instruction', () => {
		it('matches <?xml?>', () => {
			expect(match('<?xml?>')).toEqual({ kind: 'pi', length: 7 });
		});
		it('rejects unterminated PI', () => {
			expect(match('<?xml')).toBeNull();
		});
	});

	describe('declaration', () => {
		it('matches <!DOCTYPE html>', () => {
			expect(match('<!DOCTYPE html>')).toEqual({ kind: 'declaration', length: 15 });
		});
		it('requires ASCII letter after <!', () => {
			expect(match('<!1>')).toBeNull();
		});
	});

	describe('CDATA', () => {
		it('matches <![CDATA[ x ]]>', () => {
			expect(match('<![CDATA[ x ]]>')).toEqual({ kind: 'cdata', length: 15 });
		});
		it('is case-sensitive', () => {
			expect(match('<![cdata[ x ]]>')).toBeNull();
		});
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

	describe('positional', () => {
		it('matches at non-zero pos', () => {
			const raw = 'hello <span> world';
			expect(matchHtmlFormAt(raw, 6, raw.length)).toEqual({ kind: 'openTag', length: 6 });
		});
		it('respects end bound for multi-char close lookahead', () => {
			// Comment open present but close --> would be past `end`
			const raw = '<!-- not closed -->';
			expect(matchHtmlFormAt(raw, 0, 8)).toBeNull();
		});
	});
});
