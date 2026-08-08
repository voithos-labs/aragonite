import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { makeEditorActionsDeps, makeNestedHarness } from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';

// The gesture the tree-level arms model (`tree-operations/emptied-block-reload.test.ts`), driven
// through the bundles a consumer holds: `TextEditableBlock.commitInput` sends the block's own line
// ending when its text goes empty, so emptying a paragraph is an ordinary content commit.
// Miss-analysis: the blank-line settles were pinned at the tree level and through the fill
// gesture's bundle path only, so no bundle case ever emptied a block — the door the defect
// reached the consumer through had no case at all.

function makeTop(source: string) {
	const harness = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(harness.deps);
	return { ...harness, actions: createBlockEditActions(harness.deps, controller) };
}

describe('emptying a block through the top-level bundle', () => {
	it('leaves bytes that reload as the blocks still on screen', async () => {
		const h = makeTop('alpha\n\nx\n\ndelta\n');

		await h.actions.updateBlockContent(1, '\n');

		expect(serialize(h.deps.doc)).toBe('alpha\n\n\ndelta\n');
		expect(h.deps.doc.children).toHaveLength(3);
		expectParseConverged(h.deps.doc);
	});

	// The separator the run gives up sits two slots below the block the gesture names, because a
	// split leaves it on the follower.
	it('reaches the separator a split left below the blank line it opened', async () => {
		const h = makeTop('Hello\n\nSecond\n');
		await h.actions.splitBlock(0, 5);
		await h.actions.splitBlock(1, 0);
		await h.actions.updateBlockContent(1, 'x\n');
		expect(serialize(h.deps.doc)).toBe('Hello\n\nx\n\n\nSecond\n');

		await h.actions.updateBlockContent(1, '\n');

		expect(serialize(h.deps.doc)).toBe('Hello\n\n\n\nSecond\n');
		expectParseConverged(h.deps.doc);
	});
});

describe('emptying a block inside a container', () => {
	it('settles the body run and rebuilds the container raw around it', async () => {
		const h = makeNestedHarness('> alpha\n>\n> x\n>\n> delta\n', { index: 0 });

		await h.bundle.blockEdit.updateBlockContent(1, '\n', 1);

		expect(serialize(h.deps.doc)).toBe('> alpha\n>\n>\n> delta\n');
		expect(h.getNode().children).toHaveLength(3);
		expectParseConverged(h.deps.doc);
	});
});
