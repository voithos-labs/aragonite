import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { escapeUnescapedPipes, normalizeCellRaw, tableCellWrite } from '$lib/schema/table-cell-raw';

describe('escapeUnescapedPipes', () => {
	it('escapes a bare pipe', () => {
		expect(escapeUnescapedPipes('foo|bar')).toBe('foo\\|bar');
	});

	it('leaves an already-escaped pipe alone (1 backslash, odd)', () => {
		expect(escapeUnescapedPipes('foo\\|bar')).toBe('foo\\|bar');
	});

	it('escapes when preceded by an even backslash run (2)', () => {
		expect(escapeUnescapedPipes('foo\\\\|bar')).toBe('foo\\\\\\|bar');
	});

	it('returns input unchanged when no pipes present', () => {
		expect(escapeUnescapedPipes('foo bar baz')).toBe('foo bar baz');
	});

	it('escapes a leading pipe at string start', () => {
		expect(escapeUnescapedPipes('|foo')).toBe('\\|foo');
	});

	it('handles a mix of escaped and unescaped pipes', () => {
		expect(escapeUnescapedPipes('a|b\\|c|d')).toBe('a\\|b\\|c\\|d');
	});
});

describe('normalizeCellRaw', () => {
	it('collapses a line ending so the text cannot spill into the next row', () => {
		expect(normalizeCellRaw('a\nb')).toBe('a b');
		expect(normalizeCellRaw('a\r\nb')).toBe('a b');
	});

	it('escapes a delimiter freed by the collapse itself', () => {
		expect(normalizeCellRaw('a\n|b')).toBe('a \\|b');
	});

	// The write path applies this to whole raws that may already have been through it, so a second
	// pass must change nothing or the backslashes pile up.
	it('is idempotent', () => {
		for (const input of ['a|b', 'a\\|b', 'a\\\\|b', 'a\nb', 'plain']) {
			expect(normalizeCellRaw(normalizeCellRaw(input))).toBe(normalizeCellRaw(input));
		}
	});

	// `escapedCellOffset` maps a caret by running this pass over the prefix, which
	// is only exact because each character's output depends on no later character.
	it('is prefix-composable: a prefix normalizes to the prefix of the normalization', () => {
		const text = 'a|b\\|c\nd|e';
		const whole = normalizeCellRaw(text);
		for (let i = 0; i <= text.length; i++) {
			expect(whole.startsWith(normalizeCellRaw(text.slice(0, i)))).toBe(true);
		}
	});
});

// A cell has no line ending of its own, and a shared text route writes a block's text with one
// appended, so the rule drops it rather than turning it into a trailing space.
describe('the cell write rule', () => {
	const ctx = {
		node: parse('| a |\n| - |\n| x |\n').children[0],
		mode: 'authored',
		lineEnding: '\n'
	} as const;

	it('drops the trailing line ending a block write carries', () => {
		expect(tableCellWrite.normalize('a|b\n', ctx)).toBe('a\\|b');
		expect(tableCellWrite.normalize('a|b\r\n', ctx)).toBe('a\\|b');
	});

	it('maps a caret past the dropped ending onto the end of the stored bytes', () => {
		expect(tableCellWrite.mapOffset('a|b\n', 2, ctx)).toBe(3);
		expect(tableCellWrite.mapOffset('a|b\n', 4, ctx)).toBe(4);
	});
});
