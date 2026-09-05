// @vitest-environment jsdom
//
// Table cells inside a cross-block format toggle. A cell endpoint counts cells, so which cells
// a range covers is the grid's own question: a run to the endpoint cell with one side outside,
// a rectangle with both inside. Every cell span is whole-cell.
//
// Miss-analysis: the grid exclusion was a written-down decision, so nothing broke silently — but
// no test in either suite ever handed the plan a table endpoint, in either coordinate space.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createSharingState } from '$lib/tree-operations/sharing';
import {
	applyCrossBlockFormat,
	crossBlockActiveFormats,
	planCrossBlockFormat
} from '$lib/selection/cross-block/format-range';
import type { SelectionPoint } from '$lib/selection/primitives';

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

/** A cross-block endpoint inside a table: the TABLE's path, a row-major cell index, flagged. */
const cell = (path: number[], index: number): SelectionPoint => ({
	path,
	offset: index,
	cellCoordinate: true
});

/** An intra-table corner: the same shape UNFLAGGED — the pair's shared table path establishes the
 *  space (`SelectionPoint`), which is how a rectangle drag stores its two ends. */
const corner = (path: number[], index: number): SelectionPoint => ({ path, offset: index });

const TWO_COL = '| Ha | Hb |\n| --- | --- |\n| a1 | a2 |\n| b1 | b2 |\n';
const THREE_COL = '| Ha | Hb | Hc |\n| --- | --- | --- |\n| a1 | a2 | a3 |\n| b1 | b2 | b3 |\n';

/** Plan and write in one go, so the assertions read as the document the user would see. */
function toggle(
	source: string,
	start: SelectionPoint,
	end: SelectionPoint,
	format: 'strong' | 'emphasis' = 'strong'
): string | null {
	const doc = parse(source);
	const plan = planCrossBlockFormat(doc, start, end, format, undefined);
	if (!plan) return null;
	applyCrossBlockFormat(doc, plan, createSharingState(), undefined);
	return serialize(doc);
}

describe('a range with one endpoint inside a table', () => {
	// Row-major run to the endpoint cell inclusive, the reading `range-delete-table` takes for the
	// same shape. Cell 3 is `a2`, the last column — where the whole-row snap lands a real endpoint.
	it('marks the prose tail and every cell up to the end cell', () => {
		expect(toggle(`head\n\n${TWO_COL}\ntail\n`, at([0], 0), cell([1], 3))).toBe(
			'**head**\n\n| **Ha** | **Hb** |\n| --- | --- |\n| **a1** | **a2** |\n| b1 | b2 |\n\ntail\n'
		);
	});

	it('marks every cell from the start cell on, and the prose head below', () => {
		expect(toggle(`head\n\n${TWO_COL}\ntail\n`, cell([1], 2), at([2], 4))).toBe(
			'head\n\n| Ha | Hb |\n| --- | --- |\n| **a1** | **a2** |\n| **b1** | **b2** |\n\n**tail**\n'
		);
	});

	it('takes a mid-row end cell as an inclusive run, leaving the rest of its row alone', () => {
		expect(toggle(`head\n\n${THREE_COL}\ntail\n`, at([0], 0), cell([1], 4))).toBe(
			'**head**\n\n| **Ha** | **Hb** | **Hc** |\n| --- | --- | --- |\n' +
				'| **a1** | **a2** | a3 |\n| b1 | b2 | b3 |\n\ntail\n'
		);
	});
});

describe('a table wholly inside the range', () => {
	it('marks every cell, the same as the prose blocks around it', () => {
		expect(toggle(`head\n\n${TWO_COL}\ntail\n`, at([0], 0), at([2], 4))).toBe(
			'**head**\n\n| **Ha** | **Hb** |\n| --- | --- |\n| **a1** | **a2** |\n' +
				'| **b1** | **b2** |\n\n**tail**\n'
		);
	});

	it('reaches both tables when the range spans two of them', () => {
		expect(toggle(`${TWO_COL}\ntext\n\n${TWO_COL}`, cell([0], 2), cell([2], 1))).toBe(
			'| Ha | Hb |\n| --- | --- |\n| **a1** | **a2** |\n| **b1** | **b2** |\n' +
				'\n**text**\n\n' +
				'| **Ha** | **Hb** |\n| --- | --- |\n| a1 | a2 |\n| b1 | b2 |\n'
		);
	});
});

describe('both endpoints inside one table', () => {
	// The rectangle, not the row-major run between the two indices: the overlay paints a rect and
	// `range-delete-table` clears one, so the toggle must mark the cells the user sees lit.
	it('marks the rectangle the two corners span, not the cells between their indices', () => {
		expect(toggle(THREE_COL, corner([0], 4), corner([0], 7))).toBe(
			'| Ha | Hb | Hc |\n| --- | --- | --- |\n| a1 | **a2** | a3 |\n| b1 | **b2** | b3 |\n'
		);
	});

	it('spans the columns between the corners on every row it covers', () => {
		expect(toggle(THREE_COL, corner([0], 3), corner([0], 7))).toBe(
			'| Ha | Hb | Hc |\n| --- | --- | --- |\n| **a1** | **a2** | a3 |\n| **b1** | **b2** | b3 |\n'
		);
	});
});

describe('a cell whose content cannot carry the mark', () => {
	const BLANK = '| Ha |  |\n| --- | --- |\n| a1 |  |\n';

	it('is neither written nor counted, so the covered cells still unapply', () => {
		expect(
			toggle('| **Ha** |  |\n| --- | --- |\n| **a1** |  |\n', cell([0], 0), cell([0], 3))
		).toBe(BLANK);
	});

	it('leaves the blank cell blank on an apply', () => {
		expect(toggle(BLANK, cell([0], 0), cell([0], 3))).toBe(
			'| **Ha** |  |\n| --- | --- |\n| **a1** |  |\n'
		);
	});
});

// The cell's own escaping runs at the write sink, so a toggled cell holding a pipe is still one
// cell after the row re-emits its delimiters.
describe('the bytes a cell write lands', () => {
	it('keeps an escaped pipe escaped through the toggle', () => {
		expect(toggle('| a\\|b | c |\n| --- | --- |\n| d | e |\n', cell([0], 0), cell([0], 1))).toBe(
			'| **a\\|b** | **c** |\n| --- | --- |\n| d | e |\n'
		);
	});
});

describe('direction is the whole range’s coverage, cells included', () => {
	it('one plain cell makes the press an apply everywhere', () => {
		expect(
			toggle(`**head**\n\n| **Ha** | Hb |\n| --- | --- |\n| a1 | a2 |\n`, at([0], 0), cell([1], 1))
		).toBe('**head**\n\n| **Ha** | **Hb** |\n| --- | --- |\n| a1 | a2 |\n');
	});

	it('every cell covered unapplies the prose with them', () => {
		expect(
			toggle(
				`**head**\n\n| **Ha** | **Hb** |\n| --- | --- |\n| a1 | a2 |\n`,
				at([0], 0),
				cell([1], 1)
			)
		).toBe('head\n\n| Ha | Hb |\n| --- | --- |\n| a1 | a2 |\n');
	});
});

describe('the pressed-state read', () => {
	const active = (source: string, start: SelectionPoint, end: SelectionPoint) =>
		crossBlockActiveFormats(parse(source), start, end).has('strong');

	it('is true only when every covered cell carries the mark too', () => {
		expect(
			active(
				`**head**\n\n| **Ha** | **Hb** |\n| --- | --- |\n| a1 | a2 |\n`,
				at([0], 0),
				cell([1], 1)
			)
		).toBe(true);
		expect(
			active(`**head**\n\n| **Ha** | Hb |\n| --- | --- |\n| a1 | a2 |\n`, at([0], 0), cell([1], 1))
		).toBe(false);
	});

	it('ignores a blank cell rather than reading it as uncovered', () => {
		expect(
			active('| **Ha** |  |\n| --- | --- |\n| **a1** |  |\n', cell([0], 0), cell([0], 3))
		).toBe(true);
	});
});

describe('the endpoints the plan hands back', () => {
	// A toggle never moves the range between cells, so the cell side keeps its index while the
	// prose side takes the offset its own rewrite produced.
	it('leaves a cell endpoint on its cell index and re-offsets the prose one', () => {
		const doc = parse(`head\n\n${TWO_COL}\ntail\n`);
		const plan = planCrossBlockFormat(doc, cell([1], 2), at([2], 4), 'strong', undefined)!;
		expect(plan.startOffset).toBe(2);
		expect(plan.endOffset).toBe('**tail**'.length);
	});

	it('keeps both corners of a rectangle in cell space', () => {
		const doc = parse(THREE_COL);
		const plan = planCrossBlockFormat(doc, corner([0], 4), corner([0], 7), 'strong', undefined)!;
		expect(plan.startOffset).toBe(4);
		expect(plan.endOffset).toBe(7);
	});
});
