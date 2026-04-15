import { describe, it, expect } from 'vitest';
import {
	getLineLeadingWhitespace,
	getCloserFor,
	shouldAutoClose,
	shouldSkipClose,
	isBetweenEmptyPair,
	isBetweenEmptyBracketPair,
	BRACKET_PAIRS,
	QUOTE_CHARS,
	SKIP_CLOSE_CHARS
} from '../../code-surface/code-editing';

// ── getLineLeadingWhitespace ────────────────────────────────────────────────

describe('getLineLeadingWhitespace', () => {
	it('returns empty string for a line with no indent', () => {
		expect(getLineLeadingWhitespace('foo', 3)).toBe('');
	});

	it('returns the exact leading spaces of the current line', () => {
		expect(getLineLeadingWhitespace('    foo', 7)).toBe('    ');
	});

	it('returns a leading tab', () => {
		expect(getLineLeadingWhitespace('\tfoo', 4)).toBe('\t');
	});

	it('returns mixed tabs and spaces verbatim — no normalization', () => {
		expect(getLineLeadingWhitespace('\t \t foo', 7)).toBe('\t \t ');
	});

	it('finds the current line when cursor is in the middle of a multi-line string', () => {
		const text = 'line one\n    line two\n\t\tline three';
		// Offset 15 is inside "line two"; its line starts after the first \n.
		expect(getLineLeadingWhitespace(text, 15)).toBe('    ');
	});

	it('returns the indent even when cursor sits on the whitespace prefix itself', () => {
		const text = 'a\n    foo';
		// Offset 4 is between the spaces, before 'foo'.
		expect(getLineLeadingWhitespace(text, 4)).toBe('    ');
	});

	it('returns the indent of the last line when cursor is at text end', () => {
		const text = 'a\n\t\tb';
		expect(getLineLeadingWhitespace(text, text.length)).toBe('\t\t');
	});

	it('returns empty string for an empty line', () => {
		const text = 'foo\n\nbar';
		expect(getLineLeadingWhitespace(text, 4)).toBe('');
	});

	it('treats offset 0 as start of the first line', () => {
		expect(getLineLeadingWhitespace('    foo', 0)).toBe('    ');
	});
});

// ── getCloserFor / pair maps ────────────────────────────────────────────────

describe('getCloserFor', () => {
	it('maps brackets to their closers', () => {
		expect(getCloserFor('(')).toBe(')');
		expect(getCloserFor('[')).toBe(']');
		expect(getCloserFor('{')).toBe('}');
	});

	it('maps quote characters to themselves', () => {
		expect(getCloserFor("'")).toBe("'");
		expect(getCloserFor('"')).toBe('"');
		expect(getCloserFor('`')).toBe('`');
	});

	it('returns null for non-opener characters', () => {
		expect(getCloserFor('a')).toBeNull();
		expect(getCloserFor(')')).toBeNull();
		expect(getCloserFor('')).toBeNull();
	});

	it('exposes the complete bracket and quote sets', () => {
		expect(Object.keys(BRACKET_PAIRS).sort()).toEqual(['(', '[', '{']);
		expect([...QUOTE_CHARS].sort()).toEqual(['"', "'", '`']);
	});

	it('SKIP_CLOSE_CHARS contains every closer and every quote, no openers', () => {
		expect([...SKIP_CLOSE_CHARS].sort()).toEqual(['"', "'", ')', ']', '`', '}']);
	});
});

// ── shouldAutoClose ─────────────────────────────────────────────────────────

describe('shouldAutoClose', () => {
	describe('brackets', () => {
		it('pairs when the next char is end-of-text', () => {
			expect(shouldAutoClose('foo', 3, '(')).toBe(true);
		});

		it('pairs when the next char is whitespace', () => {
			expect(shouldAutoClose('foo bar', 3, '(')).toBe(true);
		});

		it('pairs when the next char is another opener', () => {
			expect(shouldAutoClose('(|)', 1, '(')).toBe(true);
		});

		it('does NOT pair when the next char is an identifier char', () => {
			// Typing `(` before `foo` — user is wrapping existing code manually.
			expect(shouldAutoClose('foo', 0, '(')).toBe(false);
		});

		it('pairs even when the previous char is an identifier (foo( case)', () => {
			// This is the canonical "open paren after function name" — must pair.
			expect(shouldAutoClose('foo', 3, '(')).toBe(true);
		});
	});

	describe('quotes', () => {
		it('pairs when surrounded by whitespace', () => {
			expect(shouldAutoClose('a  b', 2, '"')).toBe(true);
		});

		it('does NOT pair when next char is an identifier (don|t case)', () => {
			expect(shouldAutoClose('dont', 3, "'")).toBe(false);
		});

		it('does NOT pair when prev char is an identifier — quote-only rule', () => {
			// `'don|` → typing `'` should just insert, not produce `''`.
			expect(shouldAutoClose("'don", 4, "'")).toBe(false);
		});

		it('pairs at start of empty text', () => {
			expect(shouldAutoClose('', 0, '"')).toBe(true);
		});
	});
});

// ── shouldSkipClose ─────────────────────────────────────────────────────────

describe('shouldSkipClose', () => {
	it('returns true when the next char matches the typed closer', () => {
		expect(shouldSkipClose('()', 1, ')')).toBe(true);
	});

	it('returns false when the next char differs', () => {
		expect(shouldSkipClose('(a)', 1, ')')).toBe(false);
	});

	it('returns false at end of text', () => {
		expect(shouldSkipClose('(', 1, ')')).toBe(false);
	});

	it('works for quotes', () => {
		expect(shouldSkipClose('""', 1, '"')).toBe(true);
		expect(shouldSkipClose('``', 1, '`')).toBe(true);
	});

	it('returns false for typed openers even when the next char matches', () => {
		// Typing `(` before an existing `(` should produce nesting, not skip.
		expect(shouldSkipClose('((', 1, '(')).toBe(false);
		expect(shouldSkipClose('[[', 1, '[')).toBe(false);
		expect(shouldSkipClose('{{', 1, '{')).toBe(false);
	});

	it('returns false for non-pair characters', () => {
		expect(shouldSkipClose('aa', 1, 'a')).toBe(false);
	});
});

// ── isBetweenEmptyPair ──────────────────────────────────────────────────────

describe('isBetweenEmptyPair', () => {
	it('detects empty bracket pairs', () => {
		expect(isBetweenEmptyPair('()', 1)).toBe(true);
		expect(isBetweenEmptyPair('[]', 1)).toBe(true);
		expect(isBetweenEmptyPair('{}', 1)).toBe(true);
	});

	it('detects empty quote pairs', () => {
		expect(isBetweenEmptyPair('""', 1)).toBe(true);
		expect(isBetweenEmptyPair("''", 1)).toBe(true);
		expect(isBetweenEmptyPair('``', 1)).toBe(true);
	});

	it('returns false when the pair is not matching', () => {
		expect(isBetweenEmptyPair('(]', 1)).toBe(false);
		expect(isBetweenEmptyPair('"}', 1)).toBe(false);
	});

	it('returns false at text boundaries', () => {
		expect(isBetweenEmptyPair('()', 0)).toBe(false);
		expect(isBetweenEmptyPair('()', 2)).toBe(false);
		expect(isBetweenEmptyPair('', 0)).toBe(false);
	});

	it('returns false when surrounding chars are ordinary content', () => {
		expect(isBetweenEmptyPair('abc', 1)).toBe(false);
	});

	it('detects a pair inside longer text', () => {
		expect(isBetweenEmptyPair('foo(){bar}', 4)).toBe(true); // between ( and )
		expect(isBetweenEmptyPair('foo(){bar}', 6)).toBe(false); // between { and b
	});
});

// ── isBetweenEmptyBracketPair ───────────────────────────────────────────────

describe('isBetweenEmptyBracketPair', () => {
	it('detects bracket pairs', () => {
		expect(isBetweenEmptyBracketPair('()', 1)).toBe(true);
		expect(isBetweenEmptyBracketPair('[]', 1)).toBe(true);
		expect(isBetweenEmptyBracketPair('{}', 1)).toBe(true);
	});

	it('excludes quote pairs — electric indent should not expand quotes', () => {
		expect(isBetweenEmptyBracketPair('""', 1)).toBe(false);
		expect(isBetweenEmptyBracketPair("''", 1)).toBe(false);
		expect(isBetweenEmptyBracketPair('``', 1)).toBe(false);
	});

	it('returns false for mismatched or boundary positions', () => {
		expect(isBetweenEmptyBracketPair('(]', 1)).toBe(false);
		expect(isBetweenEmptyBracketPair('()', 0)).toBe(false);
		expect(isBetweenEmptyBracketPair('()', 2)).toBe(false);
	});
});
