import { describe, it, expect } from 'vitest';
import { groupMatchesByPath, pathKey } from '$lib/search/match-index';
import type { Match } from '$lib/search/document-scan';

function match(path: number[], start: number, end: number): Match {
	return { path, start, end };
}

describe('groupMatchesByPath', () => {
	it('buckets matches by owning leaf path, preserving the flat index for active detection', () => {
		const matches = [match([0], 0, 2), match([2, 1], 3, 5), match([0], 7, 9)];
		const grouped = groupMatchesByPath(matches);
		expect(grouped.get(pathKey([0]))).toEqual([
			{ match: matches[0], index: 0 },
			{ match: matches[2], index: 2 }
		]);
		expect(grouped.get(pathKey([2, 1]))).toEqual([{ match: matches[1], index: 1 }]);
	});

	it('yields an empty map for no matches; an unqueried path is absent', () => {
		const grouped = groupMatchesByPath([]);
		expect(grouped.size).toBe(0);
		expect(grouped.get(pathKey([5]))).toBeUndefined();
	});

	it('keeps sibling and prefix-adjacent paths distinct', () => {
		const matches = [match([1], 0, 1), match([1, 2], 0, 1), match([12], 0, 1)];
		const grouped = groupMatchesByPath(matches);
		expect(grouped.get(pathKey([1]))).toHaveLength(1);
		expect(grouped.get(pathKey([1, 2]))).toHaveLength(1);
		expect(grouped.get(pathKey([12]))).toHaveLength(1);
	});
});
