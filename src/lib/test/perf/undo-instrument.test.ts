import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUndoController } from '../../editor-actions/commit/undo-controller';
import { makeEditorActionsDeps } from '../harness/editor-actions';
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

beforeEach(() => {
	resetPerfInstruments();
	enablePerfInstruments();
});
afterEach(() => disablePerfInstruments());

describe('undo snapshot instrumentation', () => {
	it('one push records clone bytes and the live gauge', () => {
		const { deps, doc } = makeEditorActionsDeps([para('hello\n')]);
		const controller = createUndoController(deps);

		controller.pushUndoSnapshot(0, 0);

		const snap = perfSnapshot();
		expect(snap.snapshotCount).toBe(1);
		expect(snap.snapshotCloneBytes).toBe(docByteLength(doc));
		expect(snap.undoEntryCount).toBe(1);
		expect(snap.undoLiveBytes).toBe(docByteLength(doc));
	});

	it('gauge tracks the whole live stack across pushes', () => {
		const { deps, doc } = makeEditorActionsDeps([para('hello\n'), para('world!\n')]);
		const controller = createUndoController(deps);

		controller.pushUndoSnapshot(0, 0);
		controller.pushUndoSnapshot(1, 0);

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
