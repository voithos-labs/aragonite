import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { deleteNode, mergeIntoPrevDeepLeaf } from '$lib/tree-operations/node-ops';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// GH #173: `deleteNode`'s seam absorb looked downward only, so a merge whose rewritten survivor
// gained indentation stopped interrupting the indentation-delimited block ABOVE it and the live
// tree kept a block its own reload folds away.
// Miss-analysis: the delete pins all move a block INTO a seam, never rewrite the survivor's own
// bytes, so nothing in the suite could observe the upper edge; the G2.13 join lane excludes the
// shape by direction (a fold reads fewer blocks where #166's class read more).

describe('a merge whose survivor the block above absorbs', () => {
	it('asks the seam at the survivor’s upper edge', () => {
		const doc = parse(
			'- foo@bar.com\n\n  \n| H0 |\n| --- | --- |\n\n\n[ref]: https://example.com\n'
		);
		expect(doc.children).toHaveLength(5);

		mergeIntoPrevDeepLeaf(doc, 2, undefined, undefined, undefined);

		expect(serialize(doc)).toBe(
			'- foo@bar.com\n\n  | H0 |\n| --- | --- |\n\n\n[ref]: https://example.com\n'
		);
		expect(describeConvergence(doc)).toBeNull();
	});

	// The downward edge the hand-rolled absorb already covered, so routing the door through the
	// shared window walker (GH #179) cannot have cost it.
	it('still asks the seam the delete itself opened below', () => {
		const doc = parse('a\n# h\nb\n');
		expect(doc.children).toHaveLength(3);

		const change = deleteNode(doc, 1);

		expect(serialize(doc)).toBe('a\nb\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toMatchObject({ op: 'replace', at: 0, count: 3, newCount: 1 });
	});
});
