import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUndoController } from '../../editor-actions/commit/undo-controller';
import { makeEditorActionsDeps } from '../harness/editor-actions';
import type { UndoController } from '../../editor-actions/deps';
import { asDocPath } from '../../selection/path-math';
import type { CstNode } from '../../core/nodes';
import {
	disablePerfInstruments,
	docByteLength,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '../../perf/instruments';

function para(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

/** A commit that changes nothing still pushes its snapshot, which is what these rows measure. */
function commitNothing(controller: UndoController, index: number): Promise<boolean> {
	return controller.commitStructural({
		snapshot: { path: asDocPath([index]), offset: 0 },
		mutate: () => ({ op: 'noop' }),
		touchedNodes: []
	});
}

beforeEach(() => {
	resetPerfInstruments();
	enablePerfInstruments();
});
afterEach(() => disablePerfInstruments());

describe('undo snapshot instrumentation', () => {
	it('one push records clone bytes and the live gauge', async () => {
		const { deps, doc } = makeEditorActionsDeps([para('hello\n')]);
		const controller = createUndoController(deps);

		await commitNothing(controller, 0);

		const snap = perfSnapshot();
		expect(snap.snapshotCount).toBe(1);
		expect(snap.snapshotCloneBytes).toBe(docByteLength(doc));
		expect(snap.undoEntryCount).toBe(1);
		expect(snap.undoLiveBytes).toBe(docByteLength(doc));
	});

	it('gauge tracks the whole live stack across pushes', async () => {
		const { deps, doc } = makeEditorActionsDeps([para('hello\n'), para('world!\n')]);
		const controller = createUndoController(deps);

		await commitNothing(controller, 0);
		await commitNothing(controller, 1);

		const snap = perfSnapshot();
		expect(snap.snapshotCount).toBe(2);
		expect(snap.undoEntryCount).toBe(2);
		expect(snap.undoLiveBytes).toBe(2 * docByteLength(doc));
	});

	it('debounced pusher records through the deep-path variant', () => {
		const { deps, doc } = makeEditorActionsDeps([para('hi\n')]);
		const controller = createUndoController(deps);

		controller.pushUndoSnapshotDebounced([0], 1);
		controller.flushDebouncedCheckpoint();

		const snap = perfSnapshot();
		expect(snap.snapshotCount).toBe(1);
		expect(snap.snapshotCloneBytes).toBe(docByteLength(doc));
		expect(snap.undoEntryCount).toBe(1);
	});
});
