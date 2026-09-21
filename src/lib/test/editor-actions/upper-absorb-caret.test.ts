import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { replaceRefs } from '$lib/reactivity/publish-ref.svelte';
import { mockRef, makeNestedHarness, makeTopHarness } from '$lib/test/harness/editor-actions';
import type { BlockComponent } from '$lib/block-component';

// The caret half of GH #21: once the write's fix-up merges the block into the one above, the
// surviving block is the predecessor, so the caret must add the bytes that predecessor put in
// front of the typed ones. Miss-analysis: every content-write test asserted the tree, never
// which ref the commit focused, so a restore aimed at the pre-merge index could not fail.

interface FocusCall {
	slot: number;
	offset: unknown;
}

/** Refs that report which original index they were made for: an idMap carries them across. */
function labelledRefs(count: number, calls: FocusCall[]): BlockComponent[] {
	return Array.from({ length: count }, (_, slot) =>
		mockRef({ focus: (offset) => calls.push({ slot, offset }) })
	);
}

describe('caret after a fold above the edited block: top level', () => {
	function makeTop(source: string) {
		const harness = makeTopHarness(source);
		const calls: FocusCall[] = [];
		harness.deps.setBlockRefs(labelledRefs(harness.doc.children.length, calls));
		return { harness, actions: harness.actions, calls };
	}

	it('lands the caret past the absorbed predecessor rather than on the vacated slot', async () => {
		const h = makeTop('a\n# h\nb\n');

		// One character typed at the heading's offset 0: the caret follows the byte it typed.
		await h.actions.updateBlockContent(1, 'x# h\n', 0, 1);

		expect(serialize(h.harness.doc)).toBe('a\nx# h\nb\n');
		expect(h.harness.doc.children).toHaveLength(1);
		expect(h.calls).toEqual([{ slot: 0, offset: 3 }]);
	});

	// The multi-block case walks the replaced range from its own first block, so the walk
	// starts behind the merged-in bytes as well.
	it('walks a multi-block write from the settled window, not from the written text', async () => {
		const h = makeTop('a\n# h\nb\n');

		// Caret after the `x` the first new block carries; the walk still has to clear the two
		// bytes the predecessor put in front of it.
		await h.actions.updateBlockContent(1, 'x\n\ny\n', 0, 1);

		expect(h.harness.doc.children.map((c) => c.raw)).toEqual(['a\nx\n', 'y\nb\n']);
		expect(h.calls).toEqual([{ slot: 0, offset: 3 }]);
	});

	// The blank case reaches the same path when emptying changes the kind: a heading emptied to
	// a blank line is a non-noop trial, so the commit runs and the container above swallows the
	// index; the blank case's textStart, used by the action, not just computed at the tree op.
	it('spends the blank branch textStart when emptying a heading folds it upward', async () => {
		const h = makeTop('- item\n\n# h\n\n    code\n');

		await h.actions.updateBlockContent(1, '\n', 1, 0);

		expect(h.harness.doc.children.map((c) => [c.kind, c.raw])).toEqual([
			['list', '- item\n\n\n    code\n']
		]);
		expect(h.calls).toEqual([{ slot: 0, offset: 8 }]);
	});

	// The decline side: nothing merged above, so the caret keeps the offset it was handed.
	it('leaves the caret alone where the join above still holds', async () => {
		const h = makeTop('a\n\n# h\nb\n');

		await h.actions.updateBlockContent(1, 'x# h\n', 0, 1);

		expect(h.harness.doc.children.map((c) => c.raw)).toEqual(['a\n', 'x# h\nb\n']);
		expect(h.calls).toEqual([{ slot: 1, offset: 1 }]);
	});
});

describe('caret after a fold above the edited block: container body', () => {
	it('lands on the body block the fold left standing', async () => {
		const h = makeNestedHarness('> a\n> # h\n> b\n', { index: 0 });
		const calls: FocusCall[] = [];
		replaceRefs(h.state.innerBlockRefs, labelledRefs(h.getNode().children!.length, calls));

		await h.bundle.blockEdit.updateBlockContent(1, 'x# h\n', 0, 1);

		expect(serialize(h.deps.doc)).toBe('> a\n> x# h\n> b\n');
		expect(h.getNode().children!.map((c) => c.raw)).toEqual(['a\nx# h\nb\n']);
		expect(calls).toEqual([{ slot: 0, offset: 3 }]);
	});
});
