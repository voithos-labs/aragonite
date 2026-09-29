import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { cellPoint, type SelectionPoint } from '../../selection/primitives';
import { coverRange, rangeCoverage } from '../../selection/range-coverage';
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

// ── rangeCoverage ───────────────────────────────────────────────────────────

const TABLE_3X3 = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

function coverageOf(source: string, a: SelectionPoint, b: SelectionPoint) {
	const doc = parse(source);
	return rangeCoverage(doc, coverRange(doc, a, b));
}

interface Held {
	source: string;
	a: SelectionPoint;
	b: SelectionPoint;
	startEdge: SelectionPoint | null;
	endEdge: SelectionPoint | null;
	wholeRoots: number[][];
}

const HELD: Record<string, Held> = {
	'two paragraphs: both text edges kept, nothing whole': {
		source: 'one\n\ntwo\n',
		a: point([0], 1),
		b: point([1], 2),
		startEdge: point([0], 1),
		endEdge: point([1], 2),
		wholeRoots: []
	},
	'a quote strictly between, as one root': {
		source: 'one\n\n> a\n>\n> b\n\ntwo\n',
		a: point([0], 1),
		b: point([2], 1),
		startEdge: point([0], 1),
		endEdge: point([2], 1),
		wholeRoots: [[1]]
	},
	'a rule held whole at the start keeps no edge, so its quote is whole': {
		source: '> ---\n\npara\n',
		a: point([0, 0], 0),
		b: point([1], 4),
		startEdge: null,
		endEdge: point([1], 4),
		wholeRoots: [[0]]
	},
	'a rule held whole at the end keeps no edge, so its quote is whole': {
		source: 'para\n\n> ---\n',
		a: point([0], 0),
		b: point([1, 0], 3),
		startEdge: point([0], 0),
		endEdge: null,
		wholeRoots: [[1]]
	},
	'two quoted rules held whole': {
		source: '> ---\n\n> ---\n',
		a: point([0, 0], 0),
		b: point([1, 0], 3),
		startEdge: null,
		endEdge: null,
		wholeRoots: [[0], [1]]
	},
	'a text start keeps its slot, emptied, so its quote is not whole': {
		source: '> a\n\npara\n',
		a: point([0, 0], 0),
		b: point([1], 4),
		startEdge: point([0, 0], 0),
		endEdge: point([1], 4),
		wholeRoots: []
	},
	'a rule held whole beside text the range misses: the rule, not its quote': {
		source: '> a\n>\n> ---\n\npara\n',
		a: point([0, 1], 0),
		b: point([1], 4),
		startEdge: null,
		endEdge: point([1], 4),
		wholeRoots: [[0, 1]]
	},
	'a rule at the start the range only touches the far side of': {
		source: '---\n\npara\n',
		a: point([0], 3),
		b: point([1], 2),
		startEdge: point([0], 3),
		endEdge: point([1], 2),
		wholeRoots: []
	},
	'a closed details the start’s title row takes whole': {
		source: 'above\n\n' + CLOSED + '\nbelow\n',
		a: point([1, 0], 1),
		b: point([2], 1),
		startEdge: null,
		endEdge: point([2], 1),
		wholeRoots: [[1]]
	},
	'both ends inside one closed details': {
		source: CLOSED,
		a: point([0, 0], 0),
		b: point([0, 1], 6),
		startEdge: null,
		endEdge: null,
		wholeRoots: [[0]]
	},
	'an end on an open details’ last byte takes the details whole': {
		source: 'above\n\n' + OPEN,
		a: point([0], 1),
		b: point([1, 1], 5),
		startEdge: point([0], 1),
		endEdge: null,
		wholeRoots: [[1]]
	},
	'an end on a quote’s last byte keeps its emptied tail': {
		source: 'above\n\n> a\n',
		a: point([0], 1),
		b: point([1, 0], 1),
		startEdge: point([0], 1),
		endEdge: point([1, 0], 1),
		wholeRoots: []
	},
	'a table start that snaps to its first row is held whole': {
		source: TABLE + '\nbelow\n',
		a: cellPoint([0], 1),
		b: point([1], 2),
		startEdge: null,
		endEdge: point([1], 2),
		wholeRoots: [[0]]
	},
	'a table start in a later row keeps its rows above': {
		source: TABLE + '\nbelow\n',
		a: cellPoint([0], 3),
		b: point([1], 2),
		startEdge: cellPoint([0], 2),
		endEdge: point([1], 2),
		wholeRoots: []
	},
	'a table end that snaps to its last row is held whole, and so is its quote': {
		source: 'above\n\n> ' + TABLE.trimEnd().replace(/\n/g, '\n> ') + '\n',
		a: point([0], 1),
		b: cellPoint([1, 0], 2),
		startEdge: point([0], 1),
		endEdge: null,
		wholeRoots: [[1]]
	},
	'a rule held whole on its own': {
		source: '---\n',
		a: point([0], 0),
		b: point([0], 3),
		startEdge: null,
		endEdge: null,
		wholeRoots: [[0]]
	},
	'a paragraph’s whole text, which stays as a blank line': {
		source: 'a\n',
		a: point([0], 0),
		b: point([0], 1),
		startEdge: point([0], 0),
		endEdge: point([0], 1),
		wholeRoots: []
	}
};

describe('rangeCoverage: what the range holds whole', () => {
	it.each(Object.entries(HELD))('%s', (_name, row) => {
		const coverage = coverageOf(row.source, row.a, row.b);
		expect({
			startEdge: coverage.startEdge,
			endEdge: coverage.endEdge,
			wholeRoots: coverage.wholeRoots
		}).toEqual({ startEdge: row.startEdge, endEdge: row.endEdge, wholeRoots: row.wholeRoots });
		expect(coverage.grid).toBeNull();
	});
});

// [anchor, focus, kind, rect as top, left, rows, cols], over the 3x3 table's row-major cells.
const GRID: [number, number, string, [number, number, number, number]][] = [
	[0, 8, 'table', [0, 0, 3, 3]],
	[8, 0, 'table', [0, 0, 3, 3]],
	[2, 6, 'table', [0, 0, 3, 3]],
	[0, 2, 'row', [0, 0, 1, 3]],
	[3, 5, 'row', [1, 0, 1, 3]],
	[8, 6, 'row', [2, 0, 1, 3]],
	[0, 6, 'column', [0, 0, 3, 1]],
	[1, 7, 'column', [0, 1, 3, 1]],
	[8, 2, 'column', [0, 2, 3, 1]],
	[0, 1, 'cells', [0, 0, 1, 2]],
	[0, 3, 'cells', [0, 0, 2, 1]],
	[0, 4, 'cells', [0, 0, 2, 2]],
	[4, 4, 'cells', [1, 1, 1, 1]]
];

describe('rangeCoverage: a same-table pair', () => {
	it.each(GRID)('%i to %i holds the %s', (a, b, kind, [top, left, rows, cols]) => {
		const coverage = coverageOf(TABLE_3X3, cellPoint([0], a), cellPoint([0], b));
		expect(coverage.grid).toEqual({ kind, path: [0], rect: { top, left, rows, cols } });
		expect(coverage.wholeRoots).toEqual(kind === 'table' ? [[0]] : []);
		expect(coverage.startEdge === null).toBe(kind === 'table');
	});

	it('at any depth', () => {
		const quoted = '> ' + TABLE_3X3.trimEnd().replace(/\n/g, '\n> ') + '\n';
		const coverage = coverageOf(quoted, cellPoint([0, 0], 3), cellPoint([0, 0], 5));
		expect(coverage.grid).toEqual({
			kind: 'row',
			path: [0, 0],
			rect: { top: 1, left: 0, rows: 1, cols: 3 }
		});
	});

	it('a one-column or one-row table is held whole, not as its column or row', () => {
		const column = coverageOf(
			'| A |\n| --- |\n| 1 |\n| 2 |\n',
			cellPoint([0], 0),
			cellPoint([0], 2)
		);
		const row = coverageOf(
			'| A | B | C |\n| --- | --- | --- |\n',
			cellPoint([0], 0),
			cellPoint([0], 2)
		);
		expect([column.grid?.kind, row.grid?.kind]).toEqual(['table', 'table']);
	});
});
