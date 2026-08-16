import { describe, it, expect } from 'vitest';
import { reorderChildrenWithTrivia } from '$lib/tree-operations/reorder';
import { createSharingState } from '$lib/tree-operations/sharing';
import { applyStructuralChangeToIdsRefs } from '$lib/tree-operations/structural-change';
import { parse } from '$lib/core/parser';
import type { BlockComponent } from '$lib/block-component';

// GH #178: a fold reported `idMap: {0:0}`, so every slot below it took a fresh id and remounted —
// including blocks the gesture never touched, whose identity the incoming change still described.
// Miss-analysis: the reorder pins assert the permutation the reorder MINTS, and the absorb pins
// assert the window a fold collapses; no case ran a reorder whose window a fold then ate, so the
// composition of the two was never read at all.

/** A list above an indented paragraph: their adjacent bytes re-read as one list on reload. */
const SOURCE = '- a\n\nx\n\n  b\n';

function reorderedIds(): string[] {
	const doc = parse(SOURCE);
	expect(doc.children.map((c) => c.kind)).toEqual(['list', 'paragraph', 'paragraph']);
	const ids = ['id-list', 'id-x', 'id-b'];
	const refs: (BlockComponent | undefined)[] = [undefined, undefined, undefined];

	// Move `  b` up beside the list, which invalidates the join above it.
	const settled = reorderChildrenWithTrivia(doc.children, 2, 1, createSharingState());
	expect(doc.children.map((c) => c.kind)).toEqual(['list', 'paragraph']);

	applyStructuralChangeToIdsRefs(settled.change, ids, refs);
	return ids;
}

describe('a fold over a reorder window', () => {
	it('keeps the id of the block the fold did not eat', () => {
		expect(reorderedIds()).toEqual(['id-list', 'id-x']);
	});
});
