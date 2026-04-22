import { describe, it, expect } from 'vitest';
import { parse } from '$lib/editor/core/parser';
import { mergeListItemIntoPrevious } from '$lib/editor/tree-operations/list-ops';

describe('mergeListItemIntoPrevious — children-array contract', () => {
	it('mutates the caller-owned children copy, not a hidden internal array', () => {
		const doc = parse('- alpha\n- beta\n- gamma\n');
		const list = doc.children[0];
		expect(list.kind).toBe('list');

		const childrenCopy = list.children!.slice();
		const originalLength = childrenCopy.length;

		const { mergePoint } = mergeListItemIntoPrevious(list, childrenCopy, 2);

		expect(childrenCopy.length).toBe(originalLength - 1);

		expect(mergePoint.targetPath).toEqual([1, 0]);
		expect(mergePoint.offset).toBe('beta'.length);
	});
});
