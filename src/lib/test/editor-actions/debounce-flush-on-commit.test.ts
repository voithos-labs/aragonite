import { describe, it, expect, vi } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { makeEditorActionsDeps, makeNode } from '$lib/test/harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';

// ── A pending typing batch flushes as one input event before a structural commit ─

describe('debounce flush on structural commit', () => {
	it('mid-batch structural commit emits one buffered op:input event before its own op event', async () => {
		const { deps, events } = makeEditorActionsDeps([makeNode('paragraph', 'hello\n')]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const editHandler = vi.fn<(payload: EditEvent) => void>();
		events.on('edit', editHandler);

		// Simulate 5 keystrokes in block 0 — each call extends the batch.
		for (let i = 0; i < 5; i++) {
			controller.pushUndoSnapshotDebounced([0], i);
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
		const { deps, events } = makeEditorActionsDeps([makeNode('paragraph', 'hello\n')]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const editHandler = vi.fn<(payload: EditEvent) => void>();
		events.on('edit', editHandler);

		await actions.splitBlock(0, 5);

		const inputEvents = editHandler.mock.calls.map((c) => c[0]).filter((e) => e.op === 'input');
		expect(inputEvents).toHaveLength(0);
	});
});
