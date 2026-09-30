import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { deleteNode } from '$lib/tree-operations/settle';
import { mergeIntoPrevDeepLeaf } from '$lib/tree-operations/node-ops';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { fixtureReading } from '../harness/fixture-grammar';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { createSharingState } from '$lib/tree-operations/sharing';

// A merge whose survivor gains indentation can stop interrupting the indentation-delimited block
// above it, so the neighbour merge checks the survivor's upper edge as well as the lower one.
// Miss-analysis: GH #173, no delete case rewrote the survivor's own bytes.

describe('a merge whose survivor the block above absorbs', () => {
	it('asks the join at the survivor’s upper edge', () => {
		// Indented code: a list item or footnote already takes an indented blank line in on load.
		const doc = parse('    code\n\n    \nx\n\n\n[ref]: https://example.com\n');
		expect(doc.children).toHaveLength(5);

		const merged = mergeIntoPrevDeepLeaf(doc, 2, createSharingState(), fixtureReading());

		expect(serialize(doc)).toBe('    code\n\n    x\n\n\n[ref]: https://example.com\n');
		expect(doc.children[0].raw).toBe('    code\n\n    x\n');
		expect(describeConvergence(doc)).toBeNull();
		// The join sits in the block that absorbed it, before the `x`.
		expect(merged).toMatchObject({
			index: 0,
			targetPath: [],
			joinOffset: '    code\n\n    '.length
		});
	});

	it('still asks the join the delete itself opened below', () => {
		const doc = parse('a\n# h\nb\n');
		expect(doc.children).toHaveLength(3);

		const change = deleteNode(doc, 1, defaultGrammarView, createSharingState());

		expect(serialize(doc)).toBe('a\nb\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toMatchObject({ op: 'replace', at: 0, count: 3, newCount: 1 });
	});
});
