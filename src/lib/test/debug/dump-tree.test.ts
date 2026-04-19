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
		const out = dumpTree(doc);
		expect(out).toContain('…');
		expect(out.length).toBeLessThan(long.length + 40);
	});

	it('honours custom maxRawChars', () => {
		const doc = parse('abcdefghij\n');
		expect(dumpTree(doc, { maxRawChars: 5 })).toBe('[0] paragraph "abcde…"');
	});

	it('indents blockquote children under the blockquote', () => {
		const doc = parse('> one\n> two\n');
		const out = dumpTree(doc);
		expect(out).toContain('blockquote quoteDepth=1 children=1');
		expect(out).toContain('  [0] paragraph "one');
	});

	it('indents list/listItem/paragraph across three nesting levels', () => {
		const doc = parse('- first\n- second\n');
		const out = dumpTree(doc);
		expect(out).toMatch(/\[0\] list kind=bullet .*children=2/);
		expect(out).toMatch(/  \[0\] listItem marker="- " children=1/);
		expect(out).toMatch(/    \[0\] paragraph "first"/);
	});
});
