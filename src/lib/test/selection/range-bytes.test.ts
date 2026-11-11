// A range that enters a table at its first row, or leaves it at its last, reads as the whole table,
// so a removal never leaves a delimiter row without the header above it.
// Miss-analysis: every table row a copy or removal read started below the header and ended above
// the last row, so no row met a range holding the header but not the table.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { cellPoint, type SelectionPoint } from '#lib/selection/primitives.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { rangeBytes } from '#lib/selection/range-bytes.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';

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
});
