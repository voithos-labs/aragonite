import { describe, it, expect } from 'vitest';
import { splitLines } from '../core/lines';
import { serialize } from '../core/serializer';
import { Document, Heading, Paragraph, ThematicBreak, List, ListItem } from '../core/nodes';
import { parse } from '../core/parser';

describe('splitLines', () => {
	it('splits LF lines and preserves endings', () => {
		const lines = splitLines('a\nb\nc\n');
		expect(lines).toEqual([
			{ raw: 'a\n', text: 'a', lineEnding: '\n', start: 0, end: 2 },
			{ raw: 'b\n', text: 'b', lineEnding: '\n', start: 2, end: 4 },
			{ raw: 'c\n', text: 'c', lineEnding: '\n', start: 4, end: 6 }
		]);
	});

	it('splits CRLF lines and preserves endings', () => {
		const lines = splitLines('a\r\nb\r\n');
		expect(lines).toEqual([
			{ raw: 'a\r\n', text: 'a', lineEnding: '\r\n', start: 0, end: 3 },
			{ raw: 'b\r\n', text: 'b', lineEnding: '\r\n', start: 3, end: 6 }
		]);
	});

	it('handles final line without trailing newline', () => {
		const lines = splitLines('a\nb');
		expect(lines).toEqual([
			{ raw: 'a\n', text: 'a', lineEnding: '\n', start: 0, end: 2 },
			{ raw: 'b', text: 'b', lineEnding: '', start: 2, end: 3 }
		]);
	});

	it('handles empty string', () => {
		const lines = splitLines('');
		expect(lines).toEqual([]);
	});

	it('handles single line no newline', () => {
		const lines = splitLines('hello');
		expect(lines).toEqual([{ raw: 'hello', text: 'hello', lineEnding: '', start: 0, end: 5 }]);
	});
});

describe('serialize', () => {
	it('serializes an empty document', () => {
		const doc = new Document('', [], '');
		expect(serialize(doc)).toBe('');
	});

	it('serializes a document with prefix and suffix', () => {
		const doc = new Document('\n\n', [new Heading('', '# Title\n', { level: 1 })], '\n');
		expect(serialize(doc)).toBe('\n\n# Title\n\n');
	});

	it('serializes multiple blocks with leading trivia', () => {
		const doc = new Document(
			'',
			[
				new Heading('', '# Title\n', { level: 1 }),
				new Paragraph('\n', 'Some text.\n'),
				new ThematicBreak('\n', '---\n', { marker: '-' })
			],
			''
		);
		expect(serialize(doc)).toBe('# Title\n\nSome text.\n\n---\n');
	});
});

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

	it('parses blockquote as Blockquote node', () => {
		const doc = parse('> Hello\n');
		expect(doc.children[0].kind).toBe('blockquote');
	});
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
		{ name: 'multi-digit ordered', source: '10. Tenth\n11. Eleventh\n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}

	it('parses list as List node with ListItem children', () => {
		const doc = parse('- A\n- B\n');
		expect(doc.children[0].kind).toBe('list');
		const list = doc.children[0] as List;
		expect(list.children.length).toBe(2);
		expect(list.children[0].kind).toBe('listItem');
		expect(list.children[1].kind).toBe('listItem');
	});
});
