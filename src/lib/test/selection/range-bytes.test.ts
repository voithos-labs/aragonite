// A range that enters a table at its first row, or leaves it at its last, reads as the whole table,
// so a removal never leaves a delimiter row without the header above it.
// Miss-analysis: every table row a copy or removal read started below the header and ended above
// the last row, so no row met a range holding the header but not the table.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { cellPoint, type SelectionPoint } from '#lib/selection/primitives.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { rangeBytes, rangePaint } from '#lib/selection/range-bytes.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
const quoted = TABLE.replace(/^/gm, '> ');

function bytesOf(source: string, start: SelectionPoint, end: SelectionPoint) {
	const doc = parse(source);
	const range = rangeBytes(
		doc,
		rangeCoverage(doc, coverRange(doc, start, end)),
		documentLayout(measured(doc))
	)!;
	return source.slice(range.from, range.to);
}

describe('a range across a table edge', () => {
	it('entering at the header row takes the whole table', () => {
		expect(bytesOf(`intro\n\n${TABLE}\n`, { path: [0], offset: 2 }, cellPoint([1], 1))).toBe(
			`tro\n\n${TABLE}`
		);
	});

	it('leaving from the last row takes the whole table', () => {
		expect(bytesOf(`${TABLE}\n\nafter\n`, cellPoint([0], 4), { path: [1], offset: 2 })).toBe(
			`${TABLE}\n\naf`
		);
	});

	it('entering below the header takes the rows down to the end', () => {
		expect(bytesOf(`intro\n\n${TABLE}\n`, { path: [0], offset: 2 }, cellPoint([1], 2))).toBe(
			'tro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n'
		);
	});

	// Miss-analysis: the rows above ended a range in a middle row or left a table from its start, so
	// none read where a range leaving by the last row stops, and its line ending went with it.
	it.each([
		['at the top level', `intro\n\n${TABLE}\n\nafter\n`, [0], [1]],
		['in a quote', `> intro\n>\n${quoted}\n\nafter\n`, [0, 0], [0, 1]]
	])('leaving by the last row stops at its text, %s', (_, source, intro, table) => {
		const bytes = bytesOf(source, { path: intro, offset: 2 }, cellPoint(table, 4));
		expect(bytes).toBe(source.slice(source.indexOf('tro'), source.indexOf('4 |') + 3));
	});
});

// Miss-analysis: every heading a range ended on was ATX with no closing run, whose text ends where
// its bytes do, so no row read a range that stopped short of an underline the removal takes.
describe('a range ending at the text of a heading it holds whole', () => {
	const SETEXT = 'first\n\n***\n\nhead\n====\n\nnext\n';
	it.each([
		['a setext underline', SETEXT, [1], [2], 4, '***\n\nhead\n===='],
		['an ATX closing run', 'first\n\n***\n\n# head ##\n', [1], [2], 6, '***\n\n# head ##'],
		['in a quote', '> ***\n>\n> head\n> ---\n\nnext\n', [0, 0], [0, 1], 4, '***\n>\n> head\n> ---'],
		['but not one it ends inside', SETEXT, [1], [2], 2, '***\n\nhe']
	])('reads through %s', (_, source, rule, heading, offset, bytes) => {
		expect(bytesOf(source, { path: rule, offset: 0 }, { path: heading, offset })).toBe(bytes);
	});

	it('paints the heading as one box, underline and all', () => {
		const doc = parse(SETEXT);
		const range = coverRange(doc, { path: [1], offset: 0 }, { path: [2], offset: 4 });
		const paint = rangePaint(doc, rangeCoverage(doc, range), documentLayout(measured(doc)));
		expect(paint.boxHolding([2])).toEqual([2]);
	});

	it('a range inside the heading stops at its text', () => {
		expect(bytesOf('head\n====\n', { path: [0], offset: 0 }, { path: [0], offset: 4 })).toBe(
			'head'
		);
	});
});
