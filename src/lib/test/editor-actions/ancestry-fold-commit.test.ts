import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createContainerEditActions } from '#lib/editor-actions/container-edit.js';
import { createHistoryActions } from '#lib/editor-actions/commit/history.js';
import { createStandardNestedActions } from '#lib/editor-actions/nested/nested-actions.js';
import { registerBlockListState } from '#lib/block-lists/state-registry.js';
import {
	makeBlockListState,
	makeContainerHarness,
	makeEditorActionsDeps,
	makeNestedActionsDeps,
	makeNestedHarness,
	makeStubBlockEdit,
	makeStubFocus
} from '#lib/test/harness/editor-actions.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';

// A nested delete can let a container lazily continue into the block below, so the ancestor fix-up
// merges the two and swallows the container the commit ran in; the caret, the parent's ids and
// refs, and the undo entry must still come out right.
// Miss-analysis: container-commit tests asserted the container's own children, never the parent's.

const SOURCE = '> a\n> # h\ntext\n';

function harness() {
	const h = makeNestedHarness(SOURCE, { index: 0 });
	const errors: unknown[] = [];
	h.events.on('error', (e) => errors.push(e));
	return { ...h, errors, history: createHistoryActions(h.deps, h.controller) };
}

describe('a commit whose ancestry settle ate its own scope', () => {
	it('lands the caret where the container’s bytes begin in the survivor', async () => {
		const h = harness();

		await h.bundle.blockEdit.deleteBlock(1, 'keyless');

		expect(serialize(h.deps.doc)).toBe('> a\ntext\n');
		expect(h.landings).toMatchObject([{ leafPath: [0, 0], offset: 0 }]);
		// A collapse is a normal outcome, not something a host must hear.
		expect(h.errors).toEqual([]);
	});

	// Typing in a body's first block rebuilds the container's opener line; a container that still
	// interrupts keeps its index, and the unchanged kind keeps the write in place.
	it('leaves the slot standing when the rebuilt opener still interrupts', async () => {
		const h = makeNestedHarness('a\n> b\n', { index: 1 });

		await h.bundle.blockEdit.updateBlockContent(0, 'bz\n', 'authored', 'join-typing', 1, 2);

		expect(serialize(h.deps.doc)).toBe('a\n> bz\n');
		expect(h.deps.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'blockquote']);
		expect(h.deps.blockIds).toHaveLength(2);
	});

	// Miss-analysis: a collapse caused by a body write was tested only at the tree operation.
	it('folds the follower a body write let the container continue into', async () => {
		const h = makeNestedHarness('> a\n> # h\ntext\n', { index: 0 });
		const errors: unknown[] = [];
		h.events.on('error', (e) => errors.push(e));

		await h.bundle.blockEdit.updateBlockContent(1, 'h\n', 'authored', 'join-typing', 0);

		expect(h.deps.doc.children.map((c) => c.kind)).toEqual(['blockquote']);
		expect(serialize(h.deps.doc)).toBe('> a\n> h\ntext\n');
		expect(describeConvergence(h.deps.doc)).toBeNull();
		expect(h.deps.blockIds).toEqual(['block-0']);
		// The collapsed container's position replaces the write's own: the survivor's first leaf.
		expect(h.landings).toMatchObject([{ leafPath: [0, 0], offset: 0 }]);
		expect(errors).toEqual([]);
		expect(takeDevWarns()).toEqual([]);

		const stacks = h.deps.undoManager.getStacks();
		expect(serialize(stacks.undo[0].snapshot)).toBe('> a\n> # h\ntext\n');

		await createHistoryActions(h.deps, h.controller).requestUndo();

		expect(serialize(h.deps.doc)).toBe('> a\n> # h\ntext\n');
		expect(h.deps.blockIds).toHaveLength(2);
	});

	// Miss-analysis: the collapse test above read the caret and the bytes, never the write's result.
	it('a content commit a collapse took over still reports it wrote', async () => {
		const h = makeNestedHarness('> a\n> # h\ntext\n', { index: 0 });

		const wrote = await h.bundle.blockEdit.updateBlockContent(
			1,
			'h\n',
			'authored',
			'join-typing',
			0
		);

		expect(serialize(h.deps.doc)).toBe('> a\n> h\ntext\n');
		expect(wrote).toBe(true);
		expect(h.deps.undoManager.getStacks().undo).toHaveLength(1);
	});

	// The delete asks for a discard when nothing changed, so the collapse has to count as a change.
	it('keeps the undo entry, and undo restores the pre-fold tree', async () => {
		const h = harness();

		await h.bundle.blockEdit.deleteBlock(1, 'keyless');

		const stacks = h.deps.undoManager.getStacks();
		expect(stacks.undo).toHaveLength(1);
		expect(serialize(stacks.undo[0].snapshot)).toBe(SOURCE);

		await h.history.requestUndo();

		expect(takeDevWarns()).toEqual([]);
		expect(serialize(h.deps.doc)).toBe(SOURCE);
		expect(h.deps.doc.children.map((c) => c.kind)).toEqual(['blockquote', 'paragraph']);
		expect(h.deps.blockIds).toHaveLength(2);
	});
});

// Blanking the item makes the quote above take in the next paragraph; the caret stays put.
// Miss-analysis: the in-place write's collapse tests asserted ids and bytes, never the caret.
describe('a keystroke whose container collapses into its follower', () => {
	it('lands the caret where it was typed', async () => {
		const h = makeContainerHarness('> a\n> - b\ntext\n', [0, 1, 0]);
		expect(h.deps.doc.children.map((c) => c.kind)).toEqual(['blockquote', 'paragraph']);

		await h.bundle.blockEdit.updateBlockContent(0, '\n', 'authored', 'join-typing', 1, 0);

		expect(serialize(h.deps.doc)).toBe('> a\n>\n> - \ntext\n');
		expect(h.deps.doc.children.map((c) => c.kind)).toEqual(['blockquote']);
		expect(describeConvergence(h.deps.doc)).toBeNull();
		expect(h.landings).toMatchObject([{ leafPath: [0, 1, 0, 0], offset: 0 }]);
	});
});

/** The same cause one level down, where the collapsed array belongs to a container. */
function quotedQuoteHarness() {
	const { deps } = makeEditorActionsDeps(parse('> > a\n> > # h\n> text\n>\n> tail\n'));
	const controller = createUndoController(deps);
	const quote = () => deps.doc.children[0];
	const getNode = () => quote().children![0];
	const state = makeBlockListState(getNode);
	registerBlockListState(getNode(), state);
	const bundle = createStandardNestedActions(
		state,
		makeNestedActionsDeps({
			index: 0,
			getNode,
			path: [0, 0],
			parent: {
				blockEdit: makeStubBlockEdit(),
				focus: makeStubFocus(),
				containerEdit: createContainerEditActions(deps, controller)
			}
		})
	);
	return { deps, quote, bundle };
}

describe('a fold whose parent scope is a container, not the document', () => {
	it('publishes one id per surviving child of the owner', async () => {
		const h = quotedQuoteHarness();
		expect(h.quote().children!.map((c) => c.kind)).toEqual([
			'blockquote',
			'paragraph',
			'paragraph'
		]);

		await h.bundle.blockEdit.deleteBlock(1, 'keyless');

		expect(serialize(h.deps.doc)).toBe('> > a\n> text\n>\n> tail\n');
		expect(h.quote().children!.map((c) => c.kind)).toEqual(['blockquote', 'paragraph']);
		// An unmounted owner has no ids, which is not an empty list: starting from one would
		// write one id per changed index instead of one per child, and a wrong length is permanent.
		expect(h.quote().childIds).toHaveLength(h.quote().children!.length);
		expect(h.quote().childIds).not.toContain(undefined);
	});
});
