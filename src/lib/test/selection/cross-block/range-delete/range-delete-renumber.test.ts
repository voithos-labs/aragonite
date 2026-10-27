// Miss-analysis: every cross-block fixture with a list started it at 1 and cut no middle item,
// where a removal that renumbers nothing still reads as consecutive.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { removeHeldWhole } from '#lib/selection/cross-block/range-delete/range-delete.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { deleteRange } from '../../../harness/range-delete';
import { fixtureReading } from '../../../harness/fixture-grammar';
import { expectParseConverged } from '../../../harness/parse-converged';
import { writtenBelow } from '#lib/test/harness/settle-funnel.js';

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });
const cell = (path: number[], offset: number): SelectionPoint => ({
	path,
	offset,
	cellCoordinate: true
});

const LIST = '8. aa\n9. bb\n10. cc\n11. dd\n';
const TWO_LISTS = '1. a\n2. b\n\npp\n\n5. c\n6. d\n7. e\n';

// Every row's bytes follow one rule: the list keeps its start, and its numbers run on from it.
const ROWS = [
	{
		shape: 'a middle item into the start of the next',
		source: LIST,
		start: at([0, 1, 0], 1),
		end: at([0, 2, 0], 0),
		joined: '8. aa\n9. bcc\n10. dd\n',
		whole: '8. aa\n9. b\n10. cc\n11. dd\n'
	},
	{
		shape: 'the first item into the start of the second',
		source: LIST,
		start: at([0, 0, 0], 1),
		end: at([0, 1, 0], 0),
		joined: '8. abb\n9. cc\n10. dd\n',
		whole: '8. a\n9. bb\n10. cc\n11. dd\n'
	},
	{
		shape: 'the start of the first item into the third',
		source: '8. aa\n9. bb\n10. cc\n',
		start: at([0, 0, 0], 0),
		end: at([0, 2, 0], 0),
		joined: '8. cc\n',
		whole: '8. \n9. cc\n'
	},
	{
		shape: 'a paragraph above into the second item',
		source: 'pp\n\n8. aa\n9. bb\n10. cc\n',
		start: at([0], 1),
		end: at([1, 1, 0], 1),
		joined: 'pb\n\n8. cc\n',
		whole: 'p\n\n8. b\n9. cc\n'
	},
	{
		shape: 'one list into another, each keeping its own start',
		source: TWO_LISTS,
		start: at([0, 1, 0], 1),
		end: at([2, 1, 0], 1),
		joined: '1. a\n2. b\n\n5. e\n',
		whole: '1. a\n2. b\n\n5. \n6. e\n'
	},
	{
		shape: 'inside a nested list, leaving the outer list as it was',
		source: '1. x\n\n   4. a\n   5. b\n   6. c\n1. y\n',
		start: at([0, 0, 1, 0, 0], 1),
		end: at([0, 0, 1, 1, 0], 1),
		joined: '1. x\n\n   4. a\n   5. c\n1. y\n',
		whole: '1. x\n\n   4. a\n   5. \n   6. c\n1. y\n'
	},
	{
		shape: 'an outer item into a nested list',
		source: '3. x\n4. y\n   1. a\n   2. b\n5. z\n',
		start: at([0, 0, 0], 1),
		end: at([0, 1, 1, 0, 0], 1),
		joined: '3. x\n4. 1. b\n5. z\n',
		whole: '3. x\n4. 1. \n   2. b\n5. z\n'
	}
];

describe('a range removal keeps each ordered list’s numbers consecutive from its start', () => {
	it.each(ROWS)('Delete over $shape', ({ source, start, end, joined }) => {
		const doc = parse(source);
		deleteRange(doc, start, end);
		expect(serialize(doc)).toBe(joined);
		expectParseConverged(doc);
	});

	it.each(ROWS)('Backspace over $shape, every covered block taken whole', (row) => {
		const doc = parse(row.source);
		const coverage = rangeCoverage(doc, coverRange(doc, row.start, row.end));
		writtenBelow(
			doc,
			(scope) => removeHeldWhole(doc, coverage, scope, fixtureReading(), 'Backspace'),
			fixtureReading().grammar
		);
		expect(serialize(doc)).toBe(row.whole);
		expectParseConverged(doc);
	});

	it('a range from a table cell into the list keeps the list’s start', () => {
		const doc = parse('| h |\n| - |\n| t |\n\n8. aa\n9. bb\n10. cc\n');
		deleteRange(doc, cell([0], 1), at([1, 1, 0], 1));
		expect(serialize(doc)).toBe('| h |\n| - |\n\n8. b\n9. cc\n');
		expectParseConverged(doc);
	});
});
