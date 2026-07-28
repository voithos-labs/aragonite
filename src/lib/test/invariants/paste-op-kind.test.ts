// @vitest-environment jsdom
import { describe, it, expect, vi, type Mock } from 'vitest';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { parse } from '$lib/core/parser';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeStubBlockEdit
} from '$lib/test/harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';
import type { BlockListState } from '$lib/reactivity/block-list-state.svelte';

// G2.9 paste op-kind emission. A paste surfaces under MORE THAN ONE op kind,
// chosen by the paste STRATEGY (not the target's depth): the default single-leaf
// structural paste emits `replaceBlock` (it splices its folded replacement
// through the replace-at-parent path, at every depth), the list/container
// absorb-and-merge strategies emit `paste`, and a cross-block inline paste emits
// `updateContent` (it commits the same re-parse funnel `updateBlockContent` runs).
// A consumer counting pastes must watch all three — watching one misses the
// others. Driven through the live `pasteDispatch` so the guard tracks the real
// routing.

function editOps(handler: Mock<(e: EditEvent) => void>): string[] {
	return handler.mock.calls.map(([event]) => event.op);
}

describe('G2.9 paste op-kind emission', () => {
	it('a default structural paste emits replaceBlock, not paste', async () => {
		const { deps, events } = makeEditorActionsDeps([parse('hello world\n').children[0]]);
		const coordinator = createPasteCoordinator(createUndoController(deps), deps.revealPath);

		const onEdit = vi.fn<(e: EditEvent) => void>();
		events.on('edit', onEdit);

		// Multi-block clipboard into a plain paragraph → the default structural hook.
		await pasteDispatch(
			{ pastedText: '# heading\n\nbody\n', targetPath: [0], offset: 6 },
			{ doc: deps.doc, blockEdit: makeStubBlockEdit(), controller: coordinator }
		);

		const ops = editOps(onEdit);
		expect(ops).toContain('replaceBlock');
		expect(ops).not.toContain('paste');
	});

	it('a list-absorb paste emits paste, not replaceBlock', async () => {
		const { deps, events } = makeEditorActionsDeps([parse('1. one\n2. two\n').children[0]]);
		const coordinator = createPasteCoordinator(createUndoController(deps), deps.revealPath);

		// list-absorb commits on the outer list scope, resolved through the registry.
		const liveList = () => deps.doc.children[0];
		const listState = makeBlockListState(liveList, ['item-0', 'item-1']);
		registerBlockListState(liveList(), listState as unknown as BlockListState);

		const onEdit = vi.fn<(e: EditEvent) => void>();
		events.on('edit', onEdit);

		// A matching ordered-list item pasted onto a list item → list-absorb.
		await pasteDispatch(
			{ pastedText: '1. INSERTED\n', targetPath: [0, 0, 0], offset: 'one'.length },
			{ doc: deps.doc, blockEdit: makeStubBlockEdit(), controller: coordinator }
		);

		const ops = editOps(onEdit);
		expect(ops).toContain('paste');
		expect(ops).not.toContain('replaceBlock');
	});

	it('a cross-block inline paste emits updateContent, not paste or replaceBlock', async () => {
		const { deps, events } = makeEditorActionsDeps(parse('hello world\n').children);
		const coordinator = createPasteCoordinator(createUndoController(deps), deps.revealPath);

		const onEdit = vi.fn<(e: EditEvent) => void>();
		events.on('edit', onEdit);

		await pasteDispatch(
			{ pastedText: 'XYZ\nsecond', targetPath: [0], offset: 5 },
			{
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: coordinator,
				undoEntry: 'join'
			}
		);

		const ops = editOps(onEdit);
		expect(ops).toContain('updateContent');
		expect(ops).not.toContain('paste');
		expect(ops).not.toContain('replaceBlock');
	});
});
