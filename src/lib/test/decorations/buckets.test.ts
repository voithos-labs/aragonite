import { describe, it, expect } from 'vitest';
import { pathKey, groupDecorationsByPath } from '#lib/decorations/buckets.js';
import type { Decoration } from '#lib/decorations/types.js';

const mark = (path: number[], start = 0, end = 1): Decoration => ({
	type: 'mark',
	path,
	start,
	end,
	class: 'x'
});

describe('decoration buckets', () => {
	it('groups by owning path preserving flat index', () => {
		const decs = [mark([0]), mark([1, 0]), mark([0])];
		const byPath = groupDecorationsByPath(decs);
		expect(byPath.get(pathKey([0]))!.map((d) => d.index)).toEqual([0, 2]);
		expect(byPath.get(pathKey([1, 0]))!.map((d) => d.index)).toEqual([1]);
	});
	it('keeps sibling and prefix-adjacent paths distinct', () => {
		// [1,2] against [12]: a path key with no separator would make them the same.
		const byPath = groupDecorationsByPath([mark([1]), mark([1, 2]), mark([12])]);
		expect(byPath.get(pathKey([1]))).toHaveLength(1);
		expect(byPath.get(pathKey([1, 2]))).toHaveLength(1);
		expect(byPath.get(pathKey([12]))).toHaveLength(1);
	});
	it('empty input yields an empty map', () => {
		expect(groupDecorationsByPath([]).size).toBe(0);
	});
});
