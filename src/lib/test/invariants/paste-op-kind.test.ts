// @vitest-environment jsdom
import { describe, it, expect, vi, type Mock } from 'vitest';
import { pasteDispatch } from '#lib/tree-operations/paste/dispatch.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createPasteCoordinator } from '#lib/editor-actions/paste-coordinator.js';
import { registerBlockListState } from '#lib/reactivity/state-registry.js';
import { parse } from '#lib/core/parser.js';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeStubBlockEdit,
	pasteContext
} from '#lib/test/harness/editor-actions.js';
import type { EditEvent } from '#lib/editor-events.js';
import type { BlockListState } from '#lib/reactivity/block-list-state.svelte.js';

// A paste surfaces under more than one op kind, chosen by the paste strategy rather than the
// target's depth, so a consumer counting pastes must watch all three (G2.9).

function editOps(handler: Mock<(e: EditEvent) => void>): string[] {
	return handler.mock.calls.map(([event]) => event.op);
}

describe('G2.9 paste op-kind emission', () => {
	it('a default structural paste emits replaceBlock, not paste', async () => {
		const { deps, events } = makeEditorActionsDeps([parse('hello world\n').children[0]]);
		const coordinator = createPasteCoordinator(deps, createUndoController(deps));

		const onEdit = vi.fn<(e: EditEvent) => void>();
		events.on('edit', onEdit);

		await pasteDispatch(
			{ pastedText: '# heading\n\nbody\n', targetPath: [0], offset: 6 },
			pasteContext({ doc: deps.doc, blockEdit: makeStubBlockEdit(), controller: coordinator })
		);

		const ops = editOps(onEdit);
		expect(ops).toContain('replaceBlock');
		expect(ops).not.toContain('paste');
	});

	// Miss-analysis: the routing tests stubbed the coordinator, so none read the event a real
	// replace names.
	it.each([
		['at the top level', 'first\n\nhello world\n', [1]],
		['inside a quote', '> first\n>\n> hello world\n', [0, 1]]
	])('a default structural paste %s names the replaced block', async (_where, source, path) => {
		const { deps, events } = makeEditorActionsDeps(parse(source));
		const coordinator = createPasteCoordinator(deps, createUndoController(deps));
		const onEdit = vi.fn<(e: EditEvent) => void>();
		events.on('edit', onEdit);

		await pasteDispatch(
			{ pastedText: '# heading\n\nbody\n', targetPath: path, offset: 6 },
			pasteContext({ doc: deps.doc, blockEdit: makeStubBlockEdit(), controller: coordinator })
		);

		expect(onEdit.mock.calls.map(([event]) => event)).toEqual([
			expect.objectContaining({
				op: 'replaceBlock',
				path,
				detail: { source: 'paste-dispatch' }
			})
		]);
	});

	it('a list-absorb paste emits paste, not replaceBlock', async () => {
		const { deps, events } = makeEditorActionsDeps([parse('1. one\n2. two\n').children[0]]);
		const coordinator = createPasteCoordinator(deps, createUndoController(deps));

		// list-absorb commits on the outer list scope, resolved through the registry.
		const liveList = () => deps.doc.children[0];
		const listState = makeBlockListState(liveList, ['item-0', 'item-1']);
		registerBlockListState(liveList(), listState as unknown as BlockListState);

		const onEdit = vi.fn<(e: EditEvent) => void>();
		events.on('edit', onEdit);

		await pasteDispatch(
			{ pastedText: '1. INSERTED\n', targetPath: [0, 0, 0], offset: 'one'.length },
			pasteContext({ doc: deps.doc, blockEdit: makeStubBlockEdit(), controller: coordinator })
		);

		const ops = editOps(onEdit);
		expect(ops).toContain('paste');
		expect(ops).not.toContain('replaceBlock');
	});

	it('a cross-block inline paste emits updateContent, not paste or replaceBlock', async () => {
		const { deps, events } = makeEditorActionsDeps(parse('hello world\n').children);
		const coordinator = createPasteCoordinator(deps, createUndoController(deps));

		const onEdit = vi.fn<(e: EditEvent) => void>();
		events.on('edit', onEdit);

		await pasteDispatch(
			{ pastedText: 'XYZ\nsecond', targetPath: [0], offset: 5 },
			pasteContext({
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: coordinator,
				crossBlock: true
			})
		);

		const ops = editOps(onEdit);
		expect(ops).toContain('updateContent');
		expect(ops).not.toContain('paste');
		expect(ops).not.toContain('replaceBlock');
	});
});
