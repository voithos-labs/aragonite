import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeNestedHarness, makeTopHarness } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// The door B-F1's settle opens: routine typing writes OUTSIDE the commit ceremony, so a settle
// that folds there splices the scope with no descriptor to publish. The parallel id array is what
// keyed rendering reads, and a length it never regains is permanent.
// Miss-analysis: every fold case runs through the ceremony, where the returned change resyncs the
// arrays; the routine path was pinned for bytes only, because before the fill arm settled it could
// not splice at all.

/** A list above a blank line: filling that line with indented prose makes the list absorb it. */
const SOURCE = '- a\n\n\nzz\n';

describe('a routine content write whose settle folds', () => {
	it('publishes the fold at the document scope', async () => {
		const h = makeTopHarness(SOURCE);
		const before = h.getBlockIds();

		await h.actions.updateBlockContent(1, '  b\n', 0);

		expect(serialize(h.deps.doc)).toBe('- a\n\n  b\n\nzz\n');
		expect(describeConvergence(h.deps.doc)).toBeNull();
		expect(h.getBlockIds()).toHaveLength(h.deps.doc.children.length);
		// The follower the fold did not eat keeps its identity.
		expect(h.getBlockIds()[1]).toBe(before[2]);
	});

	it('publishes the fold at a container scope', async () => {
		const h = makeNestedHarness('> - a\n>\n>\n> zz\n', { index: 0 });
		const before = [...h.state.innerBlockIds];

		await h.bundle.blockEdit.updateBlockContent(1, '  b\n', 0);

		expect(serialize(h.deps.doc)).toBe('> - a\n>\n>   b\n>\n> zz\n');
		expect(describeConvergence(h.deps.doc)).toBeNull();
		expect(h.state.innerBlockIds).toHaveLength(h.getNode().children!.length);
		expect(h.state.innerBlockIds[1]).toBe(before[2]);
	});
});
