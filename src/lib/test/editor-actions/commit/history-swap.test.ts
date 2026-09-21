import { describe, it, expect, vi } from 'vitest';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { makeEditorActionsDeps, makeNode } from '$lib/test/harness/editor-actions';

function makeSetup() {
	const { deps, events } = makeEditorActionsDeps([makeNode('paragraph', 'aaa\n')]);
	const controller = createUndoController(deps);
	return { deps, events, controller, history: createHistoryActions(deps, controller) };
}

// captureCurrentState marks the whole tree as shared with a snapshot, forcing the next
// edit to copy its path first, for an undo that never happens.
describe('history swap: no-op guard', () => {
	it('requestUndo on an empty undo stack does not mark the tree snapshot-shared', async () => {
		const { deps, history } = makeSetup();
		const markSpy = vi.spyOn(deps.sharing, 'markSnapshotTaken');
		await history.requestUndo();
		expect(markSpy).not.toHaveBeenCalled();
	});

	it('requestRedo on an empty redo stack does not mark the tree snapshot-shared', async () => {
		const { deps, history } = makeSetup();
		const markSpy = vi.spyOn(deps.sharing, 'markSnapshotTaken');
		await history.requestRedo();
		expect(markSpy).not.toHaveBeenCalled();
	});
});

// Tests the clear on the undo side; `history.ts` says why the restore declines instead.
describe('history swap: a snapshot whose selection no longer resolves', () => {
	it('clears the standing selection instead of leaving its overlay painted', async () => {
		const { deps, history } = makeSetup();
		const pastEnd = deps.doc.children.length;
		deps.undoManager.push({
			snapshot: { ...deps.doc, children: [...deps.doc.children] },
			blockIds: [...deps.blockIds],
			selection: {
				anchor: { path: [pastEnd], offset: 0 },
				focus: { path: [pastEnd], offset: 0 }
			}
		});
		deps.selectionState.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 1 });
		expect(deps.selectionState.isCrossBlock).toBe(true);

		await history.requestUndo();

		expect(deps.selectionState.isCrossBlock).toBe(false);
	});
});

// Nothing else checks that undo keeps sharing the selection restore with the consumer's
// setSelection; growing its own would re-open the stale notification the shared restore's
// batching closed.
describe('history swap: the restored selection notifies once, after the placement', () => {
	it('emits after the applier has looked for the block, not before', async () => {
		const log: string[] = [];
		const { deps } = makeEditorActionsDeps(
			[makeNode('paragraph', 'aaa\n'), makeNode('paragraph', 'bbb\n')],
			{ onSelectionChange: () => log.push('notify') }
		);
		deps.getBlockElByPath = () => {
			log.push('place');
			return null;
		};
		const history = createHistoryActions(deps, createUndoController(deps));
		deps.undoManager.push({
			snapshot: { ...deps.doc, children: [...deps.doc.children] },
			blockIds: [...deps.blockIds],
			selection: { anchor: { path: [1], offset: 2 }, focus: { path: [1], offset: 2 } }
		});

		await history.requestUndo();

		expect(log).toEqual(['place', 'notify']);
	});
});

// Flush, not discard: the pending `input` event must reach edit listeners (discarding
// drops those bytes) and the debounce timer must be cleared.
describe('history swap: batch flush', () => {
	it('flushes a pending batch exactly once: emits its input event and clears the timer', async () => {
		vi.useFakeTimers();
		try {
			const { events, controller, history } = makeSetup();
			const inputs: string[] = [];
			events.on('edit', (e) => {
				if (e.op === 'input') inputs.push(e.op);
			});

			// Starts a batch: the first keystroke pushes a snapshot and opens the pending input batch.
			controller.pushUndoSnapshotDebounced([0], 1);
			await history.requestUndo();
			vi.advanceTimersByTime(1000);

			expect(inputs).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
