import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { cellPoint, type SelectionPoint } from '../../selection/primitives';
import { coverRange } from '../../selection/range-coverage';
import { registerChromePluginsForTests } from './chrome-plugins';

// What a range covers is read once; these rows pin the answer every reader then shares.

const CLOSED = '<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n';
const OPEN = '<details open>\n<summary>Sum</summary>\n\nShown\n\n</details>\n';
const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

const point = (path: number[], offset: number): SelectionPoint => ({ path, offset });

beforeEach(registerChromePluginsForTests);

describe('coverRange orders and snaps the pair', () => {
	it('puts the endpoints in document order', () => {
		const doc = parse('one\n\ntwo\n');
		const range = coverRange(doc, point([1], 2), point([0], 1));
		expect([range.start, range.end]).toEqual([point([0], 1), point([1], 2)]);
		expect(range.wholeUnits).toEqual([]);
	});

	it('snaps a cross-block table endpoint to whole rows', () => {
		const doc = parse('above\n\n' + TABLE);
		const range = coverRange(doc, point([0], 1), cellPoint([1], 2));
		expect(range.end).toEqual(cellPoint([1], 3));
	});

	it('returns a same-path pair as is, a cell rectangle unsnapped', () => {
		const doc = parse(TABLE);
		const range = coverRange(doc, cellPoint([0], 3), cellPoint([0], 0));
		expect([range.start, range.end]).toEqual([cellPoint([0], 0), cellPoint([0], 3)]);
	});
});

describe('coverRange takes a closed container whole', () => {
	// [0] above, [1] the details ([1,0] its title row), [2] below.
	const DOC = 'above\n\n' + CLOSED + '\nbelow\n';

	it.each([0, 1, 3])('from a start on its title row at %i', (offset) => {
		const range = coverRange(parse(DOC), point([1, 0], offset), point([2], 1));
		expect(range.wholeUnits).toEqual([[1]]);
	});

	it.each([1, 3])('from an end on its title row past byte 0, at %i', (offset) => {
		const range = coverRange(parse(DOC), point([0], 1), point([1, 0], offset));
		expect(range.wholeUnits).toEqual([[1]]);
	});

	it('not from an end at the title row’s first byte, which reaches nothing of it', () => {
		const range = coverRange(parse(DOC), point([0], 1), point([1, 0], 0));
		expect(range.wholeUnits).toEqual([]);
	});

	it('once, from a start on its title row with the end in its hidden body', () => {
		const range = coverRange(parse(CLOSED), point([0, 0], 0), point([0, 1], 6));
		expect(range.wholeUnits).toEqual([[0]]);
	});

	it('each of two, the first by its start and the second by its end', () => {
		const doc = parse(CLOSED + '\n' + CLOSED);
		expect(coverRange(doc, point([0, 0], 1), point([1, 0], 2)).wholeUnits).toEqual([[0], [1]]);
	});

	it('never an open one', () => {
		const range = coverRange(parse('above\n\n' + OPEN), point([0], 1), point([1, 0], 2));
		expect(range.wholeUnits).toEqual([]);
	});

	it('the inner one of a closed details inside an open one', () => {
		const doc = parse('<details open>\n<summary>Out</summary>\n\n' + CLOSED + '\n</details>\n');
		const range = coverRange(doc, point([0, 0], 1), point([0, 1, 0], 2));
		expect(range.wholeUnits).toEqual([[0, 1]]);
	});

	it('not a title row inside another container’s hidden body, already covered', () => {
		const doc = parse('above\n\n<details>\n<summary>Out</summary>\n\n' + CLOSED + '\n</details>\n');
		const range = coverRange(doc, point([0], 1), point([1, 1, 0], 2));
		expect(range.wholeUnits).toEqual([]);
	});
});

describe('unitHolding', () => {
	it('names the unit a path sits in, and nothing outside it', () => {
		const range = coverRange(parse('above\n\n' + CLOSED), point([0], 1), point([1, 0], 2));
		expect(range.unitHolding([1, 1])).toEqual([1]);
		expect(range.unitHolding([1])).toEqual([1]);
		expect(range.unitHolding([0])).toBeNull();
	});
});
