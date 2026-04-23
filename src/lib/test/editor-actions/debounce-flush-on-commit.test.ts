import { describe, it, expect, vi } from 'vitest';
import { createUndoController } from '$lib/editor/components/editor-actions/undo-controller';
import { createBlockEditActions } from '$lib/editor/components/editor-actions/block-edit';
import { createUndoManager } from '$lib/editor/undo-manager';
import { createSelectionState } from '$lib/editor/selection/selection-state.svelte';
import { createEditorEvents } from '$lib/editor/events/editor-events';
import type { BlockComponent, CstNode } from '$lib/editor/contracts';
import type { StickyColumnState } from '$lib/editor/contenteditable/sticky-column';
import type { EditEvent } from '$lib/editor/events/editor-events';

function mockRef(): BlockComponent {
	return {
		focus: () => {},
		getCursorOffset: () => null,
		editable: true,
		focusable: true
	} as BlockComponent;
}

function makeStickyColumn(): StickyColumnState {
	return { get: () => null, reset: vi.fn(), capture: vi.fn() };
}

function makeNode(kind: string, raw: string): CstNode {
	return { kind, leadingTrivia: '', raw } as CstNode;
}

function makeDeps(nodes: CstNode[]) {
	const doc: any = { kind: 'document', children: nodes };
	let blockIds = nodes.map((_, i) => `id-${i}`);
	let blockRefs: (BlockComponent | undefined)[] = nodes.map(() => mockRef());
	const events = createEditorEvents();
	return {
		deps: {
			get doc() {
				return doc;
			},
			get blockIds() {
				return blockIds;
			},
			get blockRefs() {
				return blockRefs;
			},
			setDoc: (v: any) => {
				Object.assign(doc, v);
			},
			setBlockIds: (v: string[]) => {
				blockIds = v;
			},
			setBlockRefs: (v: (BlockComponent | undefined)[]) => {
				blockRefs = v;
			},
			undoManager: createUndoManager(),
			stickyColumn: makeStickyColumn(),
			selectionState: createSelectionState(),
			getBlockElByPath: () => null,
			events
		},
		events
	};
}

// ── B4: pending typing batch must flush as one input event before structural commit ─

describe('debounce flush on structural commit (B4)', () => {
	it('mid-batch structural commit emits one buffered op:input event before its own op event', async () => {
		const { deps, events } = makeDeps([makeNode('paragraph', 'hello\n')]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const editHandler = vi.fn<(payload: EditEvent) => void>();
		events.on('edit', editHandler);

		// Simulate 5 keystrokes in block 0 — each call extends the batch.
		for (let i = 0; i < 5; i++) {
			controller.pushUndoSnapshotDebounced(0, i);
		}

		// No input event yet — debounce hasn't fired.
		expect(editHandler).not.toHaveBeenCalled();

		// Structural commit before debounce flush — must emit the buffered
		// keystrokes as one op:'input' event, then its own 'split' event.
		await actions.splitBlock(0, 5);

		const inputEvents = editHandler.mock.calls.map((c) => c[0]).filter((e) => e.op === 'input');
		expect(inputEvents).toHaveLength(1);
		expect(inputEvents[0].path).toEqual([0]);
		expect(inputEvents[0].detail).toMatchObject({ byteLength: 5 });

		const splitEvents = editHandler.mock.calls.map((c) => c[0]).filter((e) => e.op === 'split');
		expect(splitEvents).toHaveLength(1);

		// Order matters: input flush precedes the structural event so observers
		// see typing → split, not split → typing.
		const inputIdx = editHandler.mock.calls.findIndex((c) => c[0].op === 'input');
		const splitIdx = editHandler.mock.calls.findIndex((c) => c[0].op === 'split');
		expect(inputIdx).toBeLessThan(splitIdx);
	});

	it('no-typing structural commit does not emit a phantom input event', async () => {
		const { deps, events } = makeDeps([makeNode('paragraph', 'hello\n')]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const editHandler = vi.fn<(payload: EditEvent) => void>();
		events.on('edit', editHandler);

		await actions.splitBlock(0, 5);

		const inputEvents = editHandler.mock.calls.map((c) => c[0]).filter((e) => e.op === 'input');
		expect(inputEvents).toHaveLength(0);
	});
});
