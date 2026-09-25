import { describe, it, expect, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import { createListOverrides } from '$lib/editor-actions/list-overrides';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeNestedActionsDeps,
	makeNestedHarness,
	makeStubBlockEdit,
	makeStubFocus,
	stubBlockComponent
} from '$lib/test/harness/editor-actions';
import { takeDevWarns } from '$lib/test/support/warn-gate';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import type { BlockComponent } from '$lib/block-component';

// A nested delete stops the list interrupting the paragraph above, and the ancestor fix-up
// merges the two into one. The commit that caused it lives in a container the merge swallowed,
// so the caret, the parent's ids and refs and the undo entry all need answers the container's
// own change cannot give.
// Miss-analysis: every container-commit test asserted the container's own children, and a
// collapse at the container's own index changes an array no assertion in that family reads.

const SOURCE = 'a\n1. x\n2. y\n';

function harness() {
	const h = makeNestedHarness(SOURCE, { index: 1, listOverrides: true });
	const focused: number[] = [];
	const survivor = stubBlockComponent({
		focus: vi.fn((offset?: number) => focused.push(offset ?? -1))
	});
	h.deps.blockRefs[0] = survivor as BlockComponent;
	// The container's own refs answer too, so a caret aimed at the swallowed container is
	// visible rather than silently absent.
	const inner: number[] = [];
	h.state.innerBlockRefs[0] = stubBlockComponent({
		focus: vi.fn((o?: number) => inner.push(o ?? -1))
	});
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
		// The swallowed container has no child to focus, so the delete's own caret placement
		// found nothing, quietly: a collapse is a normal outcome, not something a host must hear.
		expect(h.inner).toEqual([]);
		expect(h.errors).toEqual([]);
	});

	// The other side, on the path that pays for it on every keystroke: routine typing in a
	// body's first block moves the container's opener line, and one that still interrupts keeps
	// its index. The kind is unchanged, so this is the noop-preview route through `withUnsharedSpine`.
	it('leaves the slot standing when the rebuilt opener still interrupts', async () => {
		const h = makeNestedHarness('a\n> b\n', { index: 1 });

		await h.bundle.blockEdit.updateBlockContent(0, 'bz\n', 1, 2);

		expect(serialize(h.deps.doc)).toBe('a\n> bz\n');
		expect(h.deps.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'blockquote']);
		expect(h.deps.blockIds).toHaveLength(2);
	});

	// The other cause of the same collapse: a body write that demotes a child stops the
	// container interrupting its follower. It arrives through the non-noop preview, a different
	// route into the same fix-up than the delete above.
	// Miss-analysis: the content write's only test was at the tree operation, so no assertion
	// covered the ids and refs, caret or undo entry for a collapse a write caused.
	it('folds the follower a body write let the container continue into', async () => {
		const h = makeNestedHarness('> a\n> # h\ntext\n', { index: 0 });
		const survivor: number[] = [];
		h.deps.blockRefs[0] = stubBlockComponent({
			focus: vi.fn((offset?: number) => survivor.push(offset ?? -1))
		}) as BlockComponent;
		const errors: unknown[] = [];
		h.events.on('error', (e) => errors.push(e));

		await h.bundle.blockEdit.updateBlockContent(1, 'h\n');

		expect(h.deps.doc.children.map((c) => c.kind)).toEqual(['blockquote']);
		expect(serialize(h.deps.doc)).toBe('> a\n> h\ntext\n');
		expect(describeConvergence(h.deps.doc)).toBeNull();
		expect(h.deps.blockIds).toEqual(['block-0']);
		expect(survivor).toEqual([0]);
		expect(errors).toEqual([]);
		expect(takeDevWarns()).toEqual([]);

		const stacks = h.deps.undoManager.getStacks();
		expect(serialize(stacks.undo[0].snapshot)).toBe('> a\n> # h\ntext\n');

		await createHistoryActions(h.deps, h.controller).requestUndo();

		expect(serialize(h.deps.doc)).toBe('> a\n> # h\ntext\n');
		expect(h.deps.blockIds).toHaveLength(2);
	});

	// The collapse is the only change on this commit (every scope's change is `noop`), and the
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

/** The same cause one level down, where the collapsed array belongs to a container. */
function quotedListHarness() {
	const { deps } = makeEditorActionsDeps(parse('> a\n> 1. x\n> 2. y\n'));
	const controller = createUndoController(deps);
	const quote = () => deps.doc.children[0];
	const getNode = () => quote().children![1];
	const state = makeBlockListState(getNode);
	registerBlockListState(getNode(), state);
	const scope = {
		get index() {
			return 1;
		},
		get node() {
			return getNode();
		},
		get path() {
			return [0, 1];
		}
	};
	const bundle = createStandardNestedActions(
		state,
		makeNestedActionsDeps({
			index: 1,
			getNode,
			path: [0, 1],
			parent: {
				blockEdit: makeStubBlockEdit(),
				focus: makeStubFocus(),
				containerEdit: createContainerEditActions(deps, controller)
			}
		}),
		createListOverrides({ scope, parentBlockEdit: makeStubBlockEdit() })
	);
	return { deps, quote, bundle };
}

describe('a fold whose parent scope is a container, not the document', () => {
	it('publishes one id per surviving child of the owner', async () => {
		const h = quotedListHarness();
		expect(h.quote().children!.map((c) => c.kind)).toEqual(['paragraph', 'list']);

		await h.bundle.blockEdit.deleteBlock(0);

		expect(serialize(h.deps.doc)).toBe('> a\n> 2. y\n');
		expect(h.quote().children!.map((c) => c.kind)).toEqual(['paragraph']);
		// An unmounted owner has no ids, which is not an empty list: starting from one would
		// write one id per changed index instead of one per child, and a wrong length is permanent.
		expect(h.quote().childIds).toHaveLength(h.quote().children!.length);
		expect(h.quote().childIds).not.toContain(undefined);
	});
});
