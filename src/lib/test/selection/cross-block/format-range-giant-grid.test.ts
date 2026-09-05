// @vitest-environment jsdom
//
// A grid whose covered cells outnumber what a call's argument list can hold. The span
// decomposition must accumulate them, never spread them into one call: an argument list
// past the engine's limit raises "Maximum call stack size exceeded" (GH #246).
//
// Miss-analysis: the format-range suite drew tables by hand, so no test ever covered a grid
// wide enough to reach the argument-count limit — the shapes were too tame for the class.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import {
	crossBlockActiveFormats,
	planCrossBlockFormat
} from '$lib/selection/cross-block/format-range';
import type { SelectionPoint } from '$lib/selection/primitives';

// Past the argument-count limit with room to spare: the ceiling is stack-dependent, so a
// count pinned just over one machine's measurement passes on the next machine's.
const ROWS = 60_000;
const COLUMNS = 3;

const GIANT_TABLE = `| a | b | c |\n| --- | --- | --- |\n${'| x | y | z |\n'.repeat(ROWS - 1)}`;

/** The cross-block endpoint shape a Ctrl+Shift+End over a table stores: the table's own path
 *  and a row-major cell index. */
const cell = (index: number): SelectionPoint => ({
	path: [0],
	offset: index,
	cellCoordinate: true
});

const LAST_CELL = ROWS * COLUMNS - 1;

describe('cross-block format over a grid larger than an argument list', () => {
	const doc = parse(GIANT_TABLE);

	it('reads the pressed state over every covered cell', () => {
		expect(doc.children[0].children).toHaveLength(ROWS);
		expect(() => crossBlockActiveFormats(doc, cell(0), cell(LAST_CELL))).not.toThrow();
	});

	it('plans the toggle over every covered cell', () => {
		expect(() =>
			planCrossBlockFormat(doc, cell(0), cell(LAST_CELL), 'strong', 'source')
		).not.toThrow();
	});
});
