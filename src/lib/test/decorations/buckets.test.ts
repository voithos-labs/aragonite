import { describe, it, expect } from 'vitest';
import {
	pathKey,
	groupDecorationsByPath,
	groupDecorationsByAncestor
} from '$lib/decorations/buckets';
import type { Decoration } from '$lib/decorations/types';

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
	it('groups under every strict ancestor prefix, root excluded', () => {
		const byAnc = groupDecorationsByAncestor([mark([2, 1, 0])]);
		expect([...byAnc.keys()].sort()).toEqual(['2', '2,1']);
	});
	it('empty input yields empty maps', () => {
		expect(groupDecorationsByPath([]).size).toBe(0);
		expect(groupDecorationsByAncestor([]).size).toBe(0);
	});
});
