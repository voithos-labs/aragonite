import { describe, it, expect, vi } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { makeEditorActionsDeps, makeNode } from '$lib/test/harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';

function makeSetup() {
	const { deps, events } = makeEditorActionsDeps([
		makeNode('paragraph', 'aaa\n'),
		makeNode('paragraph', 'bbb\n')
	]);
	const controller = createUndoController(deps);
	const editHandler = vi.fn<(payload: EditEvent) => void>();
	events.on('edit', editHandler);
	const inputEvents = () => editHandler.mock.calls.map((c) => c[0]).filter((e) => e.op === 'input');
	return { controller, editHandler, inputEvents };
}

// ── Displaced typing batch must flush as one input event on batch-key change ──

describe('debounce flush on batch-key change', () => {
	it('typing in block 1 mid-batch flushes the displaced block 0 batch as one input event', () => {
		const { controller, editHandler, inputEvents } = makeSetup();

		for (let i = 0; i < 3; i++) controller.pushUndoSnapshotDebounced([0], i);
		expect(editHandler).not.toHaveBeenCalled();

		// A key change inside the debounce window must flush block 0's batch, not drop it.
		controller.pushUndoSnapshotDebounced([1], 0);

		expect(inputEvents()).toHaveLength(1);
		expect(inputEvents()[0].path).toEqual([0]);
		expect(inputEvents()[0].detail).toMatchObject({ byteLength: 3 });

		controller.flushDebouncedCheckpoint();
	});

	it('the new batch flushes separately with its own path and byte count', () => {
		vi.useFakeTimers();
		try {
			const { controller, inputEvents } = makeSetup();

			controller.pushUndoSnapshotDebounced([0], 0);
			controller.pushUndoSnapshotDebounced([0], 1);
			controller.pushUndoSnapshotDebounced([1], 0);
			vi.runAllTimers();

			expect(inputEvents().map((e) => e.path)).toEqual([[0], [1]]);
			expect(inputEvents()[0].detail).toMatchObject({ byteLength: 2 });
			expect(inputEvents()[1].detail).toMatchObject({ byteLength: 1 });
		} finally {
			vi.useRealTimers();
		}
	});
});
