import { describe, it, expect } from 'vitest';
import { reorderChildrenWithTrivia } from '$lib/tree-operations/reorder';
import { createSharingState } from '$lib/tree-operations/sharing';
import { applyStructuralChangeToIdsRefs } from '$lib/tree-operations/structural-change';
import { parse } from '$lib/core/parser';
import type { BlockComponent } from '$lib/block-component';
import { defaultGrammarView } from '$lib/schema/block-openers';

// A reorder whose window a merge then collapses keeps the ids of the blocks it never touched, or
// every position below the merge remounts.
// Miss-analysis: GH #178, no case ran a reorder whose window a merge then collapsed.

/** A list above an indented paragraph: their adjacent bytes re-read as one list on reload. */
const SOURCE = '- a\n\nx\n\n  b\n';

function reorderedIds(): string[] {
	const doc = parse(SOURCE);
	expect(doc.children.map((c) => c.kind)).toEqual(['list', 'paragraph', 'paragraph']);
	const ids = ['id-list', 'id-x', 'id-b'];
	const refs: (BlockComponent | undefined)[] = [undefined, undefined, undefined];

	// Move `  b` up beside the list, which invalidates the join above it.
	const settled = reorderChildrenWithTrivia(
		doc.children,
		2,
		1,
		createSharingState(),
		defaultGrammarView,
		'\n'
	);
	expect(doc.children.map((c) => c.kind)).toEqual(['list', 'paragraph']);

	applyStructuralChangeToIdsRefs(settled.change, ids, refs);
	return ids;
}

describe('a fold over a reorder window', () => {
	it('keeps the id of the block the fold did not eat', () => {
		expect(reorderedIds()).toEqual(['id-list', 'id-x']);
	});
});
