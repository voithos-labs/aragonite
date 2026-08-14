import { describe, it, expect, vi } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import { makeNestedHarness, mockRef } from '$lib/test/harness/editor-actions';
import { takeDevWarns } from '$lib/test/support/warn-gate';
import type { BlockComponent } from '$lib/block-component';

// GH #176: a nested delete stops the list interrupting the paragraph above, and the ancestry
// settle folds the two into one. The commit that caused it lives in a scope the fold ate, so the
// caret, the parent scope's registers and the undo entry are all owed answers the container's
// own descriptor cannot give.
// Miss-analysis: every container-commit pin asserted the scope's own children, and a fold at the
// scope's own slot changes an array no assertion in that family reads.

const SOURCE = 'a\n1. x\n2. y\n';

function harness() {
	const h = makeNestedHarness(SOURCE, { index: 1, listOverrides: true });
	const focused: number[] = [];
	const survivor = mockRef({ focus: vi.fn((offset?: number) => focused.push(offset ?? -1)) });
	h.deps.blockRefs[0] = survivor as BlockComponent;
	// The scope's own refs answer too, so a landing aimed at the eaten container is visible
	// rather than silently absent.
	const inner: number[] = [];
	h.state.innerBlockRefs[0] = mockRef({ focus: vi.fn((o?: number) => inner.push(o ?? -1)) });
	const errors: unknown[] = [];
	h.events.on('error', (e) => errors.push(e));
	return { ...h, focused, inner, errors, history: createHistoryActions(h.deps, h.controller) };
}

describe('a commit whose ancestry settle ate its own scope', () => {
	it('lands the caret where the container’s bytes begin in the survivor', async () => {
		const h = harness();

		await h.bundle.blockEdit.deleteBlock(0);

		expect(serialize(h.deps.doc)).toBe('a\n2. y\n');
		// `'a\n'` is what the paragraph put in front of the list's own first byte.
		expect(h.focused).toEqual([2]);
		// The eaten scope has no child to focus, so the door's own landing resolved nothing —
		// quietly, since a fold is a normal outcome and not something a host must hear about.
		expect(h.inner).toEqual([]);
		expect(h.errors).toEqual([]);
	});

	// The other side of the ask, at the door that pays for it on every keystroke: routine typing
	// in a body head moves the container's opener line, and one that still interrupts keeps its
	// slot. Kind-stable, so this is the noop-preview route through `withUnsharedSpine`.
	it('leaves the slot standing when the rebuilt opener still interrupts', async () => {
		const h = makeNestedHarness('a\n> b\n', { index: 1 });

		await h.bundle.blockEdit.updateBlockContent(0, 'bz\n', 1, 2);

		expect(serialize(h.deps.doc)).toBe('a\n> bz\n');
		expect(h.deps.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'blockquote']);
		expect(h.deps.blockIds).toHaveLength(2);
	});

	// The fold is the only change on this commit — every scope descriptor is `noop` — and the
	// delete asks for a discard when nothing changed.
	it('keeps the undo entry, and undo restores the pre-fold tree', async () => {
		const h = harness();

		await h.bundle.blockEdit.deleteBlock(0);

		const stacks = h.deps.undoManager.getStacks();
		expect(stacks.undo).toHaveLength(1);
		expect(serialize(stacks.undo[0].snapshot)).toBe(SOURCE);

		await h.history.requestUndo();

		expect(takeDevWarns()).toEqual([]);
		expect(serialize(h.deps.doc)).toBe(SOURCE);
		expect(h.deps.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'list']);
		expect(h.deps.blockIds).toHaveLength(2);
	});
});
