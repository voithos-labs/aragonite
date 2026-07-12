import { describe, it, expect } from 'vitest';
import { groupMatchesByAncestor, groupMatchesByPath, pathKey } from '$lib/search/match-index';
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

describe('groupMatchesByAncestor', () => {
	it('buckets a cell match under every strict ancestor, preserving the flat index', () => {
		// Cell matches at [table, row, col]; the table overlay reads its own bucket.
		const matches = [match([0], 0, 2), match([1, 0, 1], 3, 5), match([1, 2, 0], 0, 1)];
		const grouped = groupMatchesByAncestor(matches);
		expect(grouped.get(pathKey([1]))).toEqual([
			{ match: matches[1], index: 1 },
			{ match: matches[2], index: 2 }
		]);
		expect(grouped.get(pathKey([1, 0]))).toEqual([{ match: matches[1], index: 1 }]);
	});

	it('top-level matches have no ancestor bucket; the root prefix is never a key', () => {
		const grouped = groupMatchesByAncestor([match([0], 0, 2), match([3], 1, 2)]);
		expect(grouped.size).toBe(0);
	});

	it('a nested grid buckets under the wrapping container and the grid itself', () => {
		// Table inside a blockquote: cell path [bq, table, row, col].
		const matches = [match([2, 0, 1, 1], 0, 4)];
		const grouped = groupMatchesByAncestor(matches);
		expect(grouped.get(pathKey([2, 0]))).toEqual([{ match: matches[0], index: 0 }]);
		expect(grouped.get(pathKey([2]))).toHaveLength(1);
		expect(grouped.get(pathKey([2, 0, 1, 1]))).toBeUndefined();
	});
});
