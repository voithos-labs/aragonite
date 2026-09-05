// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
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
import type { BlockListState } from '$lib/reactivity/block-list-state.svelte';
import type { EditEvent } from '$lib/editor-events';
import { takeDevWarns } from '$lib/test/support/warn-gate';

// A splice outside the commit ceremony updates neither the parent's `childIds` (which
// never self-heals: `createBlockListState` backfills only an ABSENT id array, never a
// short one) nor the `edit` stream, so persistence sees the delete and not the insertion.

function blockquoteHarness() {
	const { deps, events } = makeEditorActionsDeps(parse('> # Head\n').children);
	const liveQuote = () => deps.doc.children[0];
	const state = makeBlockListState(liveQuote, ['child-0']);
	registerBlockListState(liveQuote(), state as unknown as BlockListState);
	return {
		deps,
		events,
		liveQuote,
		coordinator: createPasteCoordinator(createUndoController(deps), deps.revealPath)
	};
}

describe("cross-block inline paste ('join') — commit ceremony participation", () => {
	it('keeps the container childIds aligned with children when the paste reparses to two blocks', async () => {
		const { deps, liveQuote, coordinator } = blockquoteHarness();

		await pasteDispatch(
			{ pastedText: 'foo\nbar', targetPath: [0, 0], offset: 'Head'.length + 2 },
			{
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: coordinator,
				undoEntry: 'join'
			}
		);

		const quote = liveQuote();
		expect(quote.children).toHaveLength(2);
		expect(quote.childIds).toHaveLength(2);
	});

	it('emits an edit event so a persistence layer records the insertion', async () => {
		const { deps, events, coordinator } = blockquoteHarness();
		const onEdit = vi.fn<(e: EditEvent) => void>();
		events.on('edit', onEdit);

		await pasteDispatch(
			{ pastedText: 'foo\nbar', targetPath: [0, 0], offset: 'Head'.length + 2 },
			{
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: coordinator,
				undoEntry: 'join'
			}
		);

		expect(onEdit.mock.calls.map(([e]) => e.op)).toContain('updateContent');
	});

	it('emits the edit event for a same-kind paste too (no structural change to ride on)', async () => {
		const { deps, events, coordinator } = blockquoteHarness();
		const onEdit = vi.fn<(e: EditEvent) => void>();
		events.on('edit', onEdit);

		await pasteDispatch(
			{ pastedText: 'ing', targetPath: [0, 0], offset: 'Head'.length + 2 },
			{
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: coordinator,
				undoEntry: 'join'
			}
		);

		expect(deps.doc.children[0].children![0].raw).toBe('# Heading\n');
		expect(onEdit.mock.calls.map(([e]) => e.op)).toContain('updateContent');
	});

	// The range delete has ALREADY committed by the time the paste dispatches, so a throw here
	// loses the selection with nothing pasted; only ref alignment is unavailable when unmounted.
	it('an unmounted container still commits instead of throwing', async () => {
		const { deps } = makeEditorActionsDeps(parse('> # Head\n').children);
		const coordinator = createPasteCoordinator(createUndoController(deps), deps.revealPath);

		await pasteDispatch(
			{ pastedText: 'foo\nbar', targetPath: [0, 0], offset: 'Head'.length + 2 },
			{
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: coordinator,
				undoEntry: 'join'
			}
		);

		const quote = deps.doc.children[0];
		expect(quote.children).toHaveLength(2);
		expect(quote.childIds).toHaveLength(2);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['paste']);
	});

	it('top-level target syncs the document-scope block ids', async () => {
		const { deps } = makeEditorActionsDeps(parse('# Head\n').children);
		const coordinator = createPasteCoordinator(createUndoController(deps), deps.revealPath);

		await pasteDispatch(
			{ pastedText: 'foo\nbar', targetPath: [0], offset: 'Head'.length + 2 },
			{
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: coordinator,
				undoEntry: 'join'
			}
		);

		expect(deps.doc.children).toHaveLength(2);
		expect(deps.blockIds).toHaveLength(2);
	});
});
