import { describe, it, expect } from 'vitest';
import { reorderChildrenWithTrivia } from '#lib/tree-operations/reorder.js';
import { documentBody } from '#lib/tree-operations/node-primitives.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { applyStructuralChangeToIdsRefs } from '#lib/tree-operations/structural-change.js';
import { parse } from '#lib/core/parser.js';
import type { BlockComponent } from '#lib/block-component.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';

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
		documentBody(doc),
		2,
		1,
		createSharingState(),
		defaultGrammarView
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
