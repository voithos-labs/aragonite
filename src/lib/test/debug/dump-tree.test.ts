import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { dumpTree } from '../../debug/dump-tree';

describe('dumpTree', () => {
	it('renders an empty document as an empty string', () => {
		const doc = parse('');
		expect(dumpTree(doc)).toBe('');
	});

	it('renders a single paragraph with truncated raw and no trivia', () => {
		const doc = parse('Hello world.\n');
		expect(dumpTree(doc)).toBe('[0] paragraph "Hello world."');
	});

	it('renders a heading with level metadata', () => {
		const doc = parse('## Getting Started\n');
		expect(dumpTree(doc)).toBe('[0] heading level=2 "## Getting Started"');
	});

	it('shows leading trivia when non-empty', () => {
		const doc = parse('one\n\n\ntwo\n');
		expect(dumpTree(doc)).toBe('[0] paragraph "one"\n[1] paragraph "two" trivia="\\n\\n"');
	});

	it('truncates raw past maxRawChars with an ellipsis', () => {
		const long = 'a'.repeat(60);
		const doc = parse(long + '\n');
		expect(dumpTree(doc)).toBe(`[0] paragraph "${'a'.repeat(40)}…"`);
	});

	it('honours custom maxRawChars', () => {
		const doc = parse('abcdefghij\n');
		expect(dumpTree(doc, { maxRawChars: 5 })).toBe('[0] paragraph "abcde…"');
	});

	it('indents blockquote children under the blockquote', () => {
		const doc = parse('> one\n> two\n');
		const out = dumpTree(doc);
		expect(out).toContain('blockquote quoteDepth=1 children=1');
		// The inner paragraph's raw carries a soft line break ("one\ntwo") and
		// therefore renders in the multi-line format: header on its own line,
		// raw on following indented lines.
		expect(out).toContain('  [0] paragraph\n    "one');
	});

	it('indents list/listItem/paragraph across three nesting levels', () => {
		const doc = parse('- first\n- second\n');
		const out = dumpTree(doc);
		expect(out).toMatch(/\[0\] list kind=bullet .*children=2/);
		expect(out).toMatch(/  \[0\] listItem marker="- " children=1/);
		expect(out).toMatch(/    \[0\] paragraph "first"/);
	});

	it('includes metaRaw when showAllMetadata is true', () => {
		const doc = parse('## Hello\n');
		expect(dumpTree(doc, { showAllMetadata: true })).toContain('metaRaw=');
	});

	it('renders multi-line raw on its own indented lines below the header', () => {
		const doc = parse('> one\n> two\n');
		const out = dumpTree(doc);
		// Header line has no inline raw; children=N is there.
		expect(out).toMatch(/^\[0\] blockquote quoteDepth=1 children=1$/m);
		// First raw line opens with `"` at depth+1 indent.
		expect(out).toContain('  "> one');
		// Continuation line is indented one more column (aligned after the quote)
		// and the final line closes the quote.
		expect(out).toContain('   > two"');
		// Child block renders AFTER the raw block.
		expect(out).toContain('  [0] paragraph');
	});

	it('keeps trivia on the header line for multi-line raw (not on the raw block)', () => {
		// Build a doc where block [1] has multi-line raw AND leading trivia.
		const doc = parse('first\n\n> two\n> three\n');
		const out = dumpTree(doc);
		// Block [1] is the blockquote; its header must end with trivia, not raw.
		expect(out).toMatch(/\[1\] blockquote [^\n]*trivia="\\n"\n {2}"/);
	});
});
