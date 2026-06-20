import { describe, it, expect } from 'vitest';
import { reorderChildren } from '$lib/editor/tree-operations/reorder';

const node = (raw: string) => ({ kind: 'paragraph', raw }) as any;

describe('reorderChildren', () => {
	it('moves down by one and returns a permutation replace', () => {
		const children = [node('a'), node('b'), node('c'), node('d')];
		const change = reorderChildren(children, 1, 2);
		expect(children.map((c) => c.raw)).toEqual(['a', 'c', 'b', 'd']);
		expect(change).toEqual({ op: 'replace', at: 1, count: 2, newCount: 2, idMap: { 0: 1, 1: 0 } });
	});

	it('moves up across a gap with a full-window permutation', () => {
		const children = [node('a'), node('b'), node('c'), node('d')];
		const change = reorderChildren(children, 3, 0); // d to front
		expect(children.map((c) => c.raw)).toEqual(['d', 'a', 'b', 'c']);
		expect(change).toEqual({
			op: 'replace',
			at: 0,
			count: 4,
			newCount: 4,
			idMap: { 0: 3, 1: 0, 2: 1, 3: 2 }
		});
	});

	it('is a noop when from === to', () => {
		const children = [node('a'), node('b')];
		expect(reorderChildren(children, 1, 1)).toEqual({ op: 'noop' });
		expect(children.map((c) => c.raw)).toEqual(['a', 'b']);
	});
});
