import { describe, it, expect } from 'vitest';

import { takeDevWarns } from '../support/warn-gate';
import {
	charOffsetOf,
	cellIndexOf,
	normalize,
	type CharSelectionPoint,
	type CellSelectionPoint,
	type SelectionPoint
} from '../../selection/primitives';
import { comparePaths } from '../../selection/path-math';

const P = (path: number[], offset: number): SelectionPoint => ({ path, offset });
const cell = (path: number[], offset: number): SelectionPoint => ({
	path,
	offset,
	cellCoordinate: true
});

describe('comparePaths', () => {
	it('returns 0 for equal paths', () => {
		expect(comparePaths([0, 1], [0, 1])).toBe(0);
		expect(comparePaths([], [])).toBe(0);
	});

	it('returns -1 when first is earlier by first differing index', () => {
		expect(comparePaths([0], [1])).toBe(-1);
		expect(comparePaths([2, 0], [2, 1])).toBe(-1);
		expect(comparePaths([1, 0, 0], [1, 0, 1])).toBe(-1);
	});

	it('returns 1 when first is later by first differing index', () => {
		expect(comparePaths([1], [0])).toBe(1);
		expect(comparePaths([3], [2, 9, 9])).toBe(1);
	});

	it('treats a strict prefix as the earlier path (ancestor before descendant)', () => {
		expect(comparePaths([2], [2, 0])).toBe(-1);
		expect(comparePaths([2, 0], [2])).toBe(1);
	});

	it('treats empty path (root) as earlier than any non-empty path', () => {
		expect(comparePaths([], [0])).toBe(-1);
		expect(comparePaths([0], [])).toBe(1);
	});
});

describe('normalize', () => {
	it('keeps a forward selection unchanged', () => {
		const anchor = P([0], 2);
		const focus = P([2], 4);
		expect(normalize({ anchor, focus })).toEqual({ start: anchor, end: focus });
	});

	it('swaps a backward selection', () => {
		const anchor = P([2], 4);
		const focus = P([0], 2);
		expect(normalize({ anchor, focus })).toEqual({ start: focus, end: anchor });
	});

	it('swaps a same-block backward selection by offset', () => {
		const anchor = P([1], 8);
		const focus = P([1], 3);
		expect(normalize({ anchor, focus })).toEqual({ start: focus, end: anchor });
	});

	it('leaves a collapsed same-block selection unchanged', () => {
		const pt = P([1], 5);
		const result = normalize({ anchor: pt, focus: pt });
		expect(result.start).toEqual(pt);
		expect(result.end).toEqual(pt);
	});
});

describe('charOffsetOf', () => {
	it('returns a char point offset without warning', () => {
		expect(charOffsetOf(P([0], 7), 'tag')).toBe(7);
		expect(takeDevWarns()).toEqual([]);
	});

	it('returns the offset but trips the guard on a cell-coordinate point', () => {
		const point = cell([0], 3);
		expect(charOffsetOf(point, 'tag')).toBe(3);
		const fires = takeDevWarns();
		expect(fires.map((w) => w.tag)).toEqual(['tag']);
		expect(fires[0].message).toBe('char-offset site received a cell-coordinate SelectionPoint');
		expect(fires[0].details).toBe(point);
	});
});

describe('cellIndexOf', () => {
	it('returns a cell point offset without warning', () => {
		expect(cellIndexOf(cell([0], 4), 'tag')).toBe(4);
		expect(takeDevWarns()).toEqual([]);
	});

	it('returns the offset but trips the guard on a char-offset point', () => {
		const point = P([0], 3);
		expect(cellIndexOf(point, 'tag')).toBe(3);
		const fires = takeDevWarns();
		expect(fires.map((w) => w.tag)).toEqual(['tag']);
		expect(fires[0].message).toBe('cell-index site received a char-offset SelectionPoint');
		expect(fires[0].details).toBe(point);
	});
});

// Compile-time pins for the discriminated union. The load-bearing assertions are the directives
// verified by `npm run check`; the runtime expectations only keep the values live for vitest.
describe('SelectionPoint discriminated union — type pins', () => {
	it('discriminates on the flag literal and narrows the union', () => {
		const cellPoint: CellSelectionPoint = { path: [0], offset: 3, cellCoordinate: true };
		const charPoint: CharSelectionPoint = { path: [0], offset: 3 };

		// A cell point is not a char point — the required-`true` flag rejects it.
		// @ts-expect-error — cellCoordinate: true is not assignable to a char point
		const notChar: CharSelectionPoint = cellPoint;

		// A char-typed slot rejects a cell point.
		const takesChar = (p: CharSelectionPoint): number => p.offset;
		// @ts-expect-error — a cell point cannot flow into a CharSelectionPoint parameter
		takesChar(cellPoint);

		// The cell variant needs the literal true — a widened boolean cannot mint it.
		const flag = Math.random() > 0.5;
		// @ts-expect-error — a widened boolean is neither the char nor the cell arm
		const widened: CellSelectionPoint = { path: [0], offset: 0, cellCoordinate: flag };

		// Checking the flag narrows a union value to the cell arm.
		const point: SelectionPoint = cellPoint;
		if (point.cellCoordinate) {
			const narrowed: CellSelectionPoint = point;
			expect(narrowed.cellCoordinate).toBe(true);
		}

		expect(takesChar(charPoint)).toBe(3);
		expect(notChar.offset).toBe(3);
		expect(widened.offset).toBe(0);
	});
});

describe('ordering is meaning-agnostic for offset', () => {
	it('orders same-path cell points by offset identically to char points', () => {
		const charLo = P([2], 1);
		const charHi = P([2], 4);
		const cellLo = cell([2], 1);
		const cellHi = cell([2], 4);

		// comparePaths ignores offset entirely — both pairs tie on path.
		expect(comparePaths(charLo.path, charHi.path)).toBe(0);
		expect(comparePaths(cellLo.path, cellHi.path)).toBe(0);

		// normalize's offset tiebreak treats cell offsets exactly like char offsets.
		expect(normalize({ anchor: cellHi, focus: cellLo })).toEqual({
			start: cellLo,
			end: cellHi
		});
		expect(normalize({ anchor: charHi, focus: charLo })).toEqual({
			start: charLo,
			end: charHi
		});
	});
});
