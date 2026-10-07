import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { deleteAtPath } from '#lib/tree-operations/path-mutate.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { rebuildOwnedContainer } from '#lib/tree-operations/unshare.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';

// A splice outside a commit can merge at any depth no commit descriptor reaches, so it keeps
// `childIds` in step itself.
// Miss-analysis: GH #183, the path-mutate cases asserted bytes and children, never the id array.

describe('a path splice whose settle folds', () => {
	it('carries the fold into the container’s childIds', () => {
		const doc = parse('> a\n> # h\n> b\n');
		const quote = doc.children[0];
		expect(quote.children).toHaveLength(3);
		quote.childIds = ['q0', 'q1', 'q2'];

		const sharing = createSharingState();
		deleteAtPath(doc, [0, 1], sharing, defaultGrammarView);
		// The function splices and fixes up; rebuilding the container's own bytes is its caller's job.
		rebuildOwnedContainer(quote);

		expect(serialize(doc)).toBe('> a\n> b\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(quote.children).toHaveLength(1);
		// One id per position, and the surviving head keeps its own.
		expect(quote.childIds).toEqual(['q0']);
	});
});
