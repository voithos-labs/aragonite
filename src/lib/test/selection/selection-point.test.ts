import { describe, it, expect } from 'vitest';
import {
	comparePaths,
	pointsEqual,
	normalize,
	isPathBetween
} from '../../selection/selection-point';
import type { SelectionPoint } from '../../selection/selection-types';

const P = (path: number[], offset: number): SelectionPoint => ({ path, offset });

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
		// [2] is an ancestor of [2, 0]; in document order, [2]'s opening comes first.
		expect(comparePaths([2], [2, 0])).toBe(-1);
		expect(comparePaths([2, 0], [2])).toBe(1);
	});

	it('treats empty path (root) as earlier than any non-empty path', () => {
		expect(comparePaths([], [0])).toBe(-1);
		expect(comparePaths([0], [])).toBe(1);
	});
});

describe('pointsEqual', () => {
	it('matches identical paths and offsets', () => {
		expect(pointsEqual(P([1, 0], 3), P([1, 0], 3))).toBe(true);
	});

	it('detects offset mismatch', () => {
		expect(pointsEqual(P([1], 0), P([1], 1))).toBe(false);
	});

	it('detects path mismatch', () => {
		expect(pointsEqual(P([0], 5), P([1], 5))).toBe(false);
		expect(pointsEqual(P([0, 1], 0), P([0], 0))).toBe(false);
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

describe('isPathBetween', () => {
	it('returns true strictly between two paths', () => {
		expect(isPathBetween([1], [0], [2])).toBe(true);
		expect(isPathBetween([1, 0], [0], [2])).toBe(true);
		expect(isPathBetween([0, 1], [0, 0], [0, 2])).toBe(true);
	});

	it('returns false at or outside the boundaries', () => {
		expect(isPathBetween([0], [0], [2])).toBe(false);
		expect(isPathBetween([2], [0], [2])).toBe(false);
		expect(isPathBetween([3], [0], [2])).toBe(false);
	});
});
