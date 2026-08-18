import { describe, it, expect } from 'vitest';
import {
	pathKey,
	groupDecorationsByPath,
	groupDecorationsByAncestor,
	collapseCellMarks
} from '$lib/decorations/buckets';
import type { Decoration, MarkDecoration } from '$lib/decorations/types';

const mark = (path: number[], start = 0, end = 1): Decoration => ({
	type: 'mark',
	path,
	start,
	end,
	class: 'x'
});

const cellMark = (path: number[], cls: string, index = 0) => ({
	dec: { type: 'mark', path, start: 0, end: 1, class: cls } as MarkDecoration,
	index
});

describe('decoration buckets', () => {
	it('groups by owning path preserving flat index', () => {
		const decs = [mark([0]), mark([1, 0]), mark([0])];
		const byPath = groupDecorationsByPath(decs);
		expect(byPath.get(pathKey([0]))!.map((d) => d.index)).toEqual([0, 2]);
		expect(byPath.get(pathKey([1, 0]))!.map((d) => d.index)).toEqual([1]);
	});
	it('keeps sibling and prefix-adjacent paths distinct', () => {
		// [1,2] vs [12] — a separator-less path key would collide them.
		const byPath = groupDecorationsByPath([mark([1]), mark([1, 2]), mark([12])]);
		expect(byPath.get(pathKey([1]))).toHaveLength(1);
		expect(byPath.get(pathKey([1, 2]))).toHaveLength(1);
		expect(byPath.get(pathKey([12]))).toHaveLength(1);
	});
	it('groups under every strict ancestor prefix, root excluded', () => {
		const byAnc = groupDecorationsByAncestor([mark([2, 1, 0])]);
		expect([...byAnc.keys()].sort()).toEqual(['2', '2,1']);
	});
	it('empty input yields empty maps', () => {
		expect(groupDecorationsByPath([]).size).toBe(0);
		expect(groupDecorationsByAncestor([]).size).toBe(0);
	});
});

describe('collapseCellMarks', () => {
	// Grid container at path [3]; cells sit at path[1] (row) and path[2] (col).
	const DEPTH = 1;

	it('collapses two same-cell marks of different classes into one unioned rect', () => {
		// The active class already contains the base token, so the union is one active
		// rect, not two stacked full-cell rects.
		const cells = collapseCellMarks(
			[
				cellMark([3, 0, 1], 'match-overlay', 0),
				cellMark([3, 0, 1], 'match-overlay match-overlay-active', 1)
			],
			DEPTH
		);
		expect(cells).toHaveLength(1);
		expect(cells[0].class.split(' ').sort()).toEqual(['match-overlay', 'match-overlay-active']);
		expect([cells[0].rowIdx, cells[0].colIdx]).toEqual([0, 1]);
	});

	it('keeps marks in distinct cells as separate rects', () => {
		const cells = collapseCellMarks(
			[cellMark([3, 0, 0], 'match-overlay'), cellMark([3, 0, 1], 'match-overlay')],
			DEPTH
		);
		expect(cells).toHaveLength(2);
	});

	it('skips a decoration with no cell coordinates', () => {
		expect(collapseCellMarks([cellMark([3, 0], 'match-overlay')], DEPTH)).toHaveLength(0);
	});
});
