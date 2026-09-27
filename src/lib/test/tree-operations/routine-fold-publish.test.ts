import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeNestedHarness, makeTopHarness } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// Routine typing writes outside the commit, so a fix-up that merges there must still resync the
// parallel id array keyed rendering reads, or its length stays wrong.
// Miss-analysis: every merge case ran through the commit; typing was checked for bytes only.

/** A list above a blank line: filling that line with indented prose makes the list absorb it. */
const SOURCE = '- a\n\n\nzz\n';

describe('a routine content write whose settle folds', () => {
	it('publishes the fold at the document scope', async () => {
		const h = makeTopHarness(SOURCE);
		const before = h.getBlockIds();

		await h.actions.updateBlockContent(1, '  b\n', 'authored', 0);

		expect(serialize(h.deps.doc)).toBe('- a\n\n  b\n\nzz\n');
		expect(describeConvergence(h.deps.doc)).toBeNull();
		expect(h.getBlockIds()).toHaveLength(h.deps.doc.children.length);
		// The follower the merge did not eat keeps its identity.
		expect(h.getBlockIds()[1]).toBe(before[2]);
	});

	it('publishes the fold at a container scope', async () => {
		const h = makeNestedHarness('> - a\n>\n>\n> zz\n', { index: 0 });
		const before = [...h.state.innerBlockIds];

		await h.bundle.blockEdit.updateBlockContent(1, '  b\n', 'authored', 0);

		expect(serialize(h.deps.doc)).toBe('> - a\n>\n>   b\n>\n> zz\n');
		expect(describeConvergence(h.deps.doc)).toBeNull();
		expect(h.state.innerBlockIds).toHaveLength(h.getNode().children!.length);
		expect(h.state.innerBlockIds[1]).toBe(before[2]);
	});
});
