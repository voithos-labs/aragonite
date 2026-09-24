import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { deleteNode } from '$lib/tree-operations/settle';
import { mergeIntoPrevDeepLeaf } from '$lib/tree-operations/node-ops';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { fixtureLinkRef } from '../harness/fixture-grammar';

// GH #173: `deleteNode`'s neighbour merge looked downward only, so a merge whose rewritten
// survivor gained indentation stopped interrupting the indentation-delimited block above it and
// the live tree kept a block its own reload merges away.
// Miss-analysis: the delete pins all move a block into a join, never rewrite the survivor's own
// bytes, so nothing in the suite could observe the upper edge; the G2.13 join lane excludes the
// shape by direction (a merge reads fewer blocks where #166's class read more).

describe('a merge whose survivor the block above absorbs', () => {
	it('asks the join at the survivor’s upper edge', () => {
		// Indented code: a list item or footnote already takes an indented blank line in on load.
		const doc = parse('    code\n\n    \nx\n\n\n[ref]: https://example.com\n');
		expect(doc.children).toHaveLength(5);

		const merged = mergeIntoPrevDeepLeaf(doc, 2, undefined, undefined, fixtureLinkRef());

		expect(serialize(doc)).toBe('    code\n\n    x\n\n\n[ref]: https://example.com\n');
		expect(doc.children[0].raw).toBe('    code\n\n    x\n');
		expect(describeConvergence(doc)).toBeNull();
		// The join now sits in the block that absorbed it, before the `x` (GH #193).
		expect(merged).toMatchObject({
			index: 0,
			targetPath: [],
			joinOffset: '    code\n\n    '.length
		});
	});

	// The downward edge the hand-rolled merge already covered, so routing the delete through the
	// shared window walker (GH #179) cannot have cost it.
	it('still asks the join the delete itself opened below', () => {
		const doc = parse('a\n# h\nb\n');
		expect(doc.children).toHaveLength(3);

		const change = deleteNode(doc, 1);

		expect(serialize(doc)).toBe('a\nb\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toMatchObject({ op: 'replace', at: 0, count: 3, newCount: 1 });
	});
});
