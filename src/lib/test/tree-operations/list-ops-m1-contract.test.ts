import { describe, it, expect } from 'vitest';
import { parse } from '$lib/editor/core/parser';
import { mergeListItemIntoPrevious } from '$lib/editor/tree-operations/list-ops';

describe('mergeListItemIntoPrevious — children-array contract', () => {
	it('mutates the caller-owned children copy, not a hidden internal array', () => {
		// Regression for Bug A: the old signature spliced list.children directly,
		// so commitContainerStructural's post-mutate publish (which writes a
		// pre-splice snapshot back to node.children) produced a zombie ListItemBlock
		// mounted at key=undefined that absorbed typed characters into the CST.
		//
		// The fix: callers now pass the children copy they intend to commit; the op
		// splices that copy and also syncs list.children (so post-splice helpers see
		// the right shape), but the splice lands in the caller-owned array — not a
		// separate internal one that the caller can't see.
		const doc = parse('- alpha\n- beta\n- gamma\n');
		const list = doc.children[0];
		expect(list.kind).toBe('list');

		const childrenCopy = list.children!.slice();
		const originalLength = childrenCopy.length; // 3

		const { mergePoint } = mergeListItemIntoPrevious(list, childrenCopy, 2);

		// The copy passed by the caller carries the deletion — gamma merged into beta.
		expect(childrenCopy.length).toBe(originalLength - 1);

		// mergePoint identifies the target paragraph: item at index 1 (beta),
		// its first (only) paragraph at [1, 0], offset = length of "beta".
		expect(mergePoint.targetPath).toEqual([1, 0]);
		expect(mergePoint.offset).toBe('beta'.length);
	});
});
