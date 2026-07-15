import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../dev-warn', () => ({ devWarn: vi.fn() }));
import { devWarn } from '../../dev-warn';
import {
	charOffsetOf,
	cellIndexOf,
	normalize,
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
	beforeEach(() => vi.mocked(devWarn).mockClear());

	it('returns a char point offset without warning', () => {
		expect(charOffsetOf(P([0], 7), 'tag')).toBe(7);
		expect(devWarn).not.toHaveBeenCalled();
	});

	it('returns the offset but trips the guard on a cell-coordinate point', () => {
		const point = cell([0], 3);
		expect(charOffsetOf(point, 'tag')).toBe(3);
		expect(devWarn).toHaveBeenCalledTimes(1);
		expect(devWarn).toHaveBeenCalledWith(
			'tag',
			'char-offset site received a cell-coordinate SelectionPoint',
			point
		);
	});
});

describe('cellIndexOf', () => {
	beforeEach(() => vi.mocked(devWarn).mockClear());

	it('returns a cell point offset without warning', () => {
		expect(cellIndexOf(cell([0], 4), 'tag')).toBe(4);
		expect(devWarn).not.toHaveBeenCalled();
	});

	it('returns the offset but trips the guard on a char-offset point', () => {
		const point = P([0], 3);
		expect(cellIndexOf(point, 'tag')).toBe(3);
		expect(devWarn).toHaveBeenCalledTimes(1);
		expect(devWarn).toHaveBeenCalledWith(
			'tag',
			'cell-index site received a char-offset SelectionPoint',
			point
		);
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
