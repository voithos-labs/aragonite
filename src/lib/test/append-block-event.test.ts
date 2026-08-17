import { describe, it, expect } from 'vitest';
import type { EditEvent } from '$lib/editor-events';

// Whichever test runs first pays the dynamic import of half the editor: ~4.7s alone, so the
// default 5s cap is blown by any battery contention. A hang guard, not a budget.
describe('moveFocus past the last block', { timeout: 20_000 }, () => {
	it('emits op=appendBlock and no op=split', async () => {
		const { createEditorEvents } = await import('$lib/editor-events');
		const { createUndoController } = await import('$lib/editor-actions/commit/undo-controller');
		const { createFocusActions } = await import('$lib/editor-actions/focus/focus');
		const { createUndoManager } = await import('$lib/undo/manager');
		const { createSharingState } = await import('$lib/tree-operations/sharing');
		const { createSelectionState } = await import('$lib/selection/selection-state.svelte');
		const { makeEdgeAffinity } = await import('./harness/editor-actions');

		const events = createEditorEvents();
		const captured: EditEvent[] = [];
		events.on('edit', (e) => captured.push(e));

		const doc: any = {
			kind: 'document',
			prefix: '',
			children: [{ kind: 'paragraph', leadingTrivia: '\n', raw: 'hello\n' }],
			suffix: ''
		};
		const blockIds = ['id0'];
		const blockRefs: any[] = [undefined];

		const deps: any = {
			get doc() {
				return doc;
			},
			get blockIds() {
				return blockIds;
			},
			get blockRefs() {
				return blockRefs;
			},
			setDoc: (v: any) => Object.assign(doc, v),
			setBlockIds: (ids: string[]) => {
				blockIds.length = 0;
				blockIds.push(...ids);
			},
			setBlockRefs: (refs: any[]) => {
				blockRefs.length = 0;
				blockRefs.push(...refs);
			},
			// This env asserts on the edit-event channel; the door census owns the version.
			bumpContentVersion: () => {},
			undoManager: createUndoManager(),
			sharing: createSharingState(),
			stickyColumn: {
				reset() {},
				capture() {},
				get current() {
					return null;
				},
				get() {
					return null;
				}
			},
			edgeAffinity: makeEdgeAffinity(),
			selectionState: createSelectionState(),
			getBlockElByPath: () => null,
			events
		};

		const controller = createUndoController(deps);
		const focus = createFocusActions(deps, controller);

		await focus.moveFocus(doc.children.length, 'start');

		const appendEvents = captured.filter((e) => e.op === 'appendBlock');
		const splitEvents = captured.filter((e) => e.op === 'split');

		expect(appendEvents).toHaveLength(1);
		expect(splitEvents).toHaveLength(0);
		expect(appendEvents[0].path).toEqual([1]);
	});

	// Separator and paragraph are both pure line ending, so both take the document's
	// (G4.20) — a defaulted `\n` pair puts two lone LFs at the end of a CRLF file.
	it('takes the last block’s line ending for both the separator and the paragraph', async () => {
		const { createUndoController } = await import('$lib/editor-actions/commit/undo-controller');
		const { createFocusActions } = await import('$lib/editor-actions/focus/focus');
		const { makeEditorActionsDeps } = await import('./harness/editor-actions');
		const { parse } = await import('$lib/core/parser');

		const { deps, doc } = makeEditorActionsDeps(parse('hello\r\n').children);
		const focus = createFocusActions(deps, createUndoController(deps));

		await focus.moveFocus(doc.children.length, 'start');

		expect(doc.children[1].leadingTrivia).toBe('\r\n');
		expect(doc.children[1].raw).toBe('\r\n');
	});

	it('with { append: false } is a no-op at the document end — no block, no event', async () => {
		const { createUndoController } = await import('$lib/editor-actions/commit/undo-controller');
		const { createFocusActions } = await import('$lib/editor-actions/focus/focus');
		const { makeEditorActionsDeps } = await import('./harness/editor-actions');

		const { deps, doc, events } = makeEditorActionsDeps([
			{ kind: 'paragraph', leadingTrivia: '\n', raw: 'hello\n' } as any
		]);
		const captured: EditEvent[] = [];
		events.on('edit', (e) => captured.push(e));

		const controller = createUndoController(deps);
		const focus = createFocusActions(deps, controller);

		await focus.moveFocus(doc.children.length, 'start', { append: false });

		expect(doc.children).toHaveLength(1);
		expect(captured).toHaveLength(0);
	});
});
