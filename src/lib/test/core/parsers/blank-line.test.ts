import { describe, expect, it } from 'vitest';
import { isBlankLine } from '$lib/core/parser';

// GFM §2.1 and cmark-gfm's `is_blank` both accept only U+0020 and U+0009, so every other
// whitespace codepoint is content — a word-processor paste artifact included.

const NBSP = String.fromCharCode(0xa0);
const VERTICAL_TAB = String.fromCharCode(0x0b);
const FORM_FEED = String.fromCharCode(0x0c);
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);

describe('isBlankLine', () => {
	it.each([
		['empty', ''],
		['spaces', '   '],
		['tabs', '\t\t'],
		['mixed spaces and tabs', ' \t \t']
	])('%s is blank', (_label, text) => {
		expect(isBlankLine(text)).toBe(true);
	});

	it.each([
		['non-breaking space', NBSP],
		['non-breaking space among spaces', `  ${NBSP}  `],
		['vertical tab', VERTICAL_TAB],
		['form feed', FORM_FEED],
		['ideographic space', IDEOGRAPHIC_SPACE],
		['ordinary text', 'a']
	])('%s is not blank', (_label, text) => {
		expect(isBlankLine(text)).toBe(false);
	});

	it('leaves a lone carriage return non-blank, matching the line model', () => {
		// splitLines only ends a line at `\n`, so a bare `\r` is content bytes to
		// this parser — calling it blank would contradict the line splitter.
		expect(isBlankLine('\r')).toBe(false);
	});
});
