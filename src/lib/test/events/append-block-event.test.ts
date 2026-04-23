import { describe, it, expect } from 'vitest';
import type { EditEvent } from '$lib/editor/events/editor-events';

describe('moveFocus past the last block', () => {
	it('emits op=appendBlock and no op=split', async () => {
		const { createEditorEvents } = await import('$lib/editor/events/editor-events');
		const { createUndoController } = await import('$lib/editor/editor-actions/undo-controller');
		const { createFocusActions } = await import('$lib/editor/editor-actions/focus');
		const { createUndoManager } = await import('$lib/editor/undo-manager');
		const { createSelectionState } = await import('$lib/editor/selection/selection-state.svelte');

		const events = createEditorEvents();
		const captured: EditEvent[] = [];
		events.on('edit', (e) => captured.push(e));

		const doc: any = {
			kind: 'document',
			children: [{ kind: 'paragraph', leadingTrivia: '\n', raw: 'hello\n' }]
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
			undoManager: createUndoManager(),
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
});
