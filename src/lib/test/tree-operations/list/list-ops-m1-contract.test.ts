import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { mergeListItemIntoPrevious } from '$lib/tree-operations/list/unwrap-merge';

describe('mergeListItemIntoPrevious — children-array contract', () => {
	it('mutates the caller-owned children copy, not a hidden internal array', () => {
		const doc = parse('- alpha\n- beta\n- gamma\n');
		const list = doc.children[0];
		expect(list.kind).toBe('list');

		const childrenCopy = list.children!.slice();
		const originalLength = childrenCopy.length;

		const result = mergeListItemIntoPrevious(list, childrenCopy, 2);
		if (!result) throw new Error('expected a merge target');

		expect(childrenCopy.length).toBe(originalLength - 1);

		expect(result.mergePoint.targetPath).toEqual([1, 0]);
		expect(result.mergePoint.offset).toBe('beta'.length);
	});
});
