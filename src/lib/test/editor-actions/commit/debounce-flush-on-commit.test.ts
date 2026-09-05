import { describe, it, expect, vi } from 'vitest';
import { makeNode, makeTopHarness } from '$lib/test/harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';

// ── A pending typing batch flushes as one input event before a structural commit ─

describe('debounce flush on structural commit', () => {
	it('mid-batch structural commit emits one buffered op:input event before its own op event', async () => {
		const { events, controller, actions } = makeTopHarness([makeNode('paragraph', 'hello\n')]);

		const editHandler = vi.fn<(payload: EditEvent) => void>();
		events.on('edit', editHandler);

		for (let i = 0; i < 5; i++) {
			controller.pushUndoSnapshotDebounced([0], i);
		}

		expect(editHandler).not.toHaveBeenCalled();

		await actions.splitBlock(0, 5);

		const inputEvents = editHandler.mock.calls.map((c) => c[0]).filter((e) => e.op === 'input');
		expect(inputEvents).toHaveLength(1);
		expect(inputEvents[0].path).toEqual([0]);
		expect(inputEvents[0].detail).toMatchObject({ byteLength: 5 });

		const splitEvents = editHandler.mock.calls.map((c) => c[0]).filter((e) => e.op === 'split');
		expect(splitEvents).toHaveLength(1);

		// Observers must see typing → split, not split → typing.
		const inputIdx = editHandler.mock.calls.findIndex((c) => c[0].op === 'input');
		const splitIdx = editHandler.mock.calls.findIndex((c) => c[0].op === 'split');
		expect(inputIdx).toBeLessThan(splitIdx);
	});

	it('no-typing structural commit does not emit a phantom input event', async () => {
		const { events, actions } = makeTopHarness([makeNode('paragraph', 'hello\n')]);

		const editHandler = vi.fn<(payload: EditEvent) => void>();
		events.on('edit', editHandler);

		await actions.splitBlock(0, 5);

		const inputEvents = editHandler.mock.calls.map((c) => c[0]).filter((e) => e.op === 'input');
		expect(inputEvents).toHaveLength(0);
	});
});
