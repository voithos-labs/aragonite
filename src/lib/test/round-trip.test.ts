/**
 * Round-trip tests: parse(source) → serialize → assert exact equality.
 * Organized by block type.
 */

import { describe, it, expect } from 'vitest';
import { serialize } from '../core/serializer';
import { parse } from '../core/parser';

// ── Leaf Blocks ─────────────────────────────────────────────────────────────

describe('round-trip: leaf blocks', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'single heading', source: '# Hello\n' },
		{
			name: 'heading levels',
			source: '# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n'
		},
		{ name: 'heading with no trailing newline', source: '# Hello' },
		{ name: 'paragraph', source: 'Hello world.\n' },
		{ name: 'multi-line paragraph', source: 'Line one.\nLine two.\nLine three.\n' },
		{ name: 'heading then paragraph', source: '# Title\n\nSome body text.\n' },
		{ name: 'fenced code backticks', source: '```js\nconsole.log(1);\n```\n' },
		{ name: 'fenced code tildes', source: '~~~\ncode\n~~~\n' },
		{ name: 'fenced code 4 backticks', source: '````\ncode with ``` inside\n````\n' },
		{ name: 'unclosed fenced code', source: '```\ncode\nmore code\n' },
		{ name: 'thematic break ---', source: '---\n' },
		{ name: 'thematic break ***', source: '***\n' },
		{ name: 'thematic break ___', source: '___\n' },
		{ name: 'thematic break spaced', source: '- - -\n' },
		{ name: 'empty document', source: '' },
		{ name: 'only blank lines', source: '\n\n\n' },
		{ name: 'leading blank lines', source: '\n\n# Title\n' },
		{ name: 'trailing blank lines', source: '# Title\n\n\n' },
		{ name: 'multiple blank lines between blocks', source: '# A\n\n\n\n# B\n' },
		{ name: 'CRLF line endings', source: '# Title\r\n\r\nParagraph.\r\n' },
		{
			name: 'mixed content',
			source: '# Title\n\nParagraph text.\n\n```\ncode\n```\n\n---\n\nMore text.\n'
		}
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}
});

// ── Container Blocks ────────────────────────────────────────────────────────

describe('round-trip: blockquotes', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'simple blockquote', source: '> Hello\n' },
		{ name: 'multi-line blockquote', source: '> Line 1\n> Line 2\n' },
		{ name: 'blockquote with heading', source: '> # Title\n' },
		{ name: 'blockquote with paragraph', source: '> Some text\n> continues here.\n' },
		{ name: 'blockquote then paragraph', source: '> Quote\n\nParagraph.\n' },
		{ name: 'nested blockquote', source: '> > Nested\n' },
		{ name: 'blockquote with blank inner line', source: '> \n> Content\n' },
		{ name: 'blockquote with code block', source: '> ```\n> code\n> ```\n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}

});

describe('round-trip: lists', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'unordered single item', source: '- Item\n' },
		{ name: 'unordered multiple items', source: '- A\n- B\n- C\n' },
		{ name: 'ordered list', source: '1. First\n2. Second\n' },
		{ name: 'ordered with paren', source: '1) A\n2) B\n' },
		{ name: 'task list', source: '- [ ] Todo\n- [x] Done\n' },
		{ name: 'plus marker', source: '+ Item\n' },
		{ name: 'star marker', source: '* Item\n' },
		{ name: 'list then paragraph', source: '- Item\n\nParagraph.\n' },
		{ name: 'multi-digit ordered', source: '10. Tenth\n11. Eleventh\n' },
		{ name: 'continuation line', source: '- Item\n  more text\n' },
		{ name: 'multi-paragraph item', source: '- Para 1\n\n  Para 2\n' },
		{ name: 'nested unordered list', source: '- Item 1\n  - Nested a\n  - Nested b\n- Item 2\n' },
		{ name: 'nested ordered in unordered', source: '- Item\n  1. First\n  2. Second\n' },
		{ name: 'deeply nested list', source: '- L1\n  - L2\n    - L3\n' },
		{ name: 'item with code block', source: '- Item\n  ```\n  code\n  ```\n' },
		{ name: 'item with blockquote', source: '- Item\n  > quote\n' },
		{ name: 'ordered with continuation', source: '1. Item\n   more text\n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}

});

// ── V2 Block Types ──────────────────────────────────────────────────────────

describe('round-trip: setext headings', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'setext H1', source: 'Title\n===\n' },
		{ name: 'setext H2', source: 'Title\n---\n' },
		{ name: 'setext H1 long underline', source: 'Title\n==========\n' },
		{ name: 'setext H2 short underline', source: 'Title\n--\n' },
		{ name: 'setext with multi-line content', source: 'Line one\nLine two\n---\n' },
		{ name: 'setext then paragraph', source: 'Title\n===\n\nBody text.\n' },
		{ name: 'setext H1 after blank lines', source: '\nTitle\n===\n' },
		{ name: 'setext H2 trailing space on underline', source: 'Title\n--- \n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}

});

describe('round-trip: indented code blocks', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'single line', source: '    code line\n' },
		{ name: 'multiple lines', source: '    line 1\n    line 2\n' },
		{ name: 'tab indented', source: '\tcode line\n' },
		{ name: 'mixed indent', source: '    line 1\n\tline 2\n' },
		{ name: 'with blank line inside', source: '    line 1\n\n    line 2\n' },
		{ name: 'after paragraph', source: 'Paragraph.\n\n    code\n' },
		{ name: 'before paragraph', source: '    code\n\nParagraph.\n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}

});

describe('round-trip: HTML blocks', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'div block', source: '<div>\n  <p>Hello</p>\n</div>\n' },
		{ name: 'comment', source: '<!-- comment -->\n' },
		{ name: 'multiline comment', source: '<!--\n  comment\n-->\n' },
		{ name: 'pre block', source: '<pre>\ncode\n</pre>\n' },
		{ name: 'script block', source: '<script>\nalert(1);\n</script>\n' },
		{ name: 'self-closing', source: '<hr />\n' },
		{ name: 'html then paragraph', source: '<div>\nHello\n</div>\n\nParagraph.\n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}

});

describe('round-trip: link reference definitions', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'basic', source: '[ref]: https://example.com\n' },
		{ name: 'with title double quotes', source: '[ref]: https://example.com "Title"\n' },
		{ name: 'with title single quotes', source: "[ref]: https://example.com 'Title'\n" },
		{ name: 'with title parens', source: '[ref]: https://example.com (Title)\n' },
		{ name: 'with angle bracket url', source: '[ref]: <https://example.com>\n' },
		{ name: 'multi-word label', source: '[my ref]: https://example.com\n' },
		{ name: 'after paragraph', source: 'Paragraph.\n\n[ref]: https://example.com\n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}

});

describe('round-trip: tables', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'simple table', source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n' },
		{
			name: 'aligned columns',
			source: '| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |\n'
		},
		{ name: 'header only', source: '| A | B |\n| --- | --- |\n' },
		{ name: 'no leading pipe', source: 'A | B\n--- | ---\n1 | 2\n' },
		{ name: 'table then paragraph', source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n\nText.\n' },
		{ name: 'many rows', source: '| H |\n| --- |\n| 1 |\n| 2 |\n| 3 |\n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}

});
