// A line with no pipe straight after a table's rows is one more row, as GFM reads it (spec example
// 201); only a blank line or the start of another block ends the table (GH #439). Expected shapes
// checked against cmark-gfm through api.github.com/markdown.
// Miss-analysis: every table-boundary pin gave the line below a table a pipe or a block marker,
// so the pipe test standing in for GFM's rule was never contradicted.
import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

function parsed(source: string) {
	const doc = parse(source);
	expect(serialize(doc)).toBe(source);
	return doc;
}

const cellsOf = (row: { children?: { raw: string }[] }) => row.children!.map((c) => c.raw);

describe('a line with no pipe after a table', () => {
	it('is a body row holding the line in its first cell', () => {
		const doc = parsed(TABLE + 'Para one.\n');

		expect(doc.children.map((c) => c.kind)).toEqual(['table']);
		const rows = doc.children[0].children!;
		expect(rows).toHaveLength(3);
		expect(cellsOf(rows[2])).toEqual(['Para one.', '']);
		expect(rows[2].raw).toBe('Para one.\n');
	});

	it('reads GFM example 201: rows until the blank line, then a paragraph', () => {
		const doc = parsed('| abc | def |\n| --- | --- |\n| bar | baz |\nbar\n\nbar\n');

		expect(doc.children.map((c) => c.kind)).toEqual(['table', 'paragraph']);
		expect(doc.children[0].children).toHaveLength(3);
	});

	it('is a row right under the delimiter row too', () => {
		const doc = parsed('| a | b |\n| --- | --- |\nplain\n');

		expect(doc.children.map((c) => c.kind)).toEqual(['table']);
		expect(cellsOf(doc.children[0].children![1])).toEqual(['plain', '']);
	});

	it('is a row where no block opens, a setext-looking line included', () => {
		expect(parsed(TABLE + '===\n').children.map((c) => c.kind)).toEqual(['table']);
	});
});

describe('the lines that still end a table', () => {
	it.each([
		['a blank line', '\nPara\n', 'paragraph'],
		['a heading', '# h\n', 'heading'],
		['a quote', '> q\n', 'blockquote'],
		['a list', '- x\n', 'list'],
		['an ordered list not starting at one', '2. x\n', 'list'],
		['a thematic break', '---\n', 'thematicBreak'],
		['a fence', '```\nc\n```\n', 'fencedCode'],
		['indented code', '    code\n', 'indentedCode'],
		['an HTML block', '<div>\n', 'htmlBlock']
	])('%s', (_, tail, kind) => {
		expect(parsed(TABLE + tail).children.map((c) => c.kind)).toEqual(['table', kind]);
	});
});
