/**
 * HistoryActions factory: capture current state for the swap entry, replay the
 * entry's snapshot, restore the saved selection. Snapshots share the live tree's
 * nodes, so a restore re-marks the epoch and re-copies the children array — else a
 * later publish writes the stack's own entry.
 */

import { tick } from 'svelte';
import type { HistoryActions } from '../../action-contracts';
import { isGapSelection, type UndoEntry } from '../../undo/types';
import { assertInvariant } from '../../assert';
import { checkSnapshotIntegrity } from '../../invariants/snapshot-integrity';
import { restoreGapCaret, restoreSelection } from '../../selection/selection-restore';
import type { EditorActionsDeps, UndoController } from '../deps';

export function createHistoryActions(
	deps: EditorActionsDeps,
	controller: UndoController
): HistoryActions {
	async function restore(entry: UndoEntry, op: 'undo' | 'redo'): Promise<void> {
		assertInvariant('snapshot-integrity', () => {
			const violation = checkSnapshotIntegrity(entry);
			return violation && { ...violation, message: `${op}: ${violation.message}` };
		});
		// Ahead of the swap itself, so a landing awaiting across it reads the new stamp
		// whichever side of the doc write its reveal resolves on.
		controller.noteHistorySwap();
		deps.sharing.markSnapshotTaken();
		deps.setDoc({ ...entry.snapshot, children: [...entry.snapshot.children] });
		deps.bumpContentVersion();
		// A copy: live state splices this array in place, and the entry stays on the stack.
		deps.setBlockIds([...entry.blockIds]);
		// The tick belongs to the doc swap above, not to the restore: the new tree
		// must render before the shared seam can reveal or address anything in it.
		await tick();
		const restoreDeps = {
			getDoc: () => deps.doc,
			selectionState: deps.selectionState,
			getBlockElByPath: deps.getBlockElByPath,
			// Mount, not scroll into view: a history swap must not move the viewport for
			// a target already on screen.
			revealTarget: async (path: number[]) => (await deps.revealPath(path)) !== null
		};
		const outcome = isGapSelection(entry.selection)
			? await restoreGapCaret(entry.selection.gapCaret, restoreDeps)
			: await restoreSelection(entry.selection, restoreDeps);
		// An entry can name a slot that never existed in its own snapshot (append-past-end declares
		// the one-past-the-end coordinate as its restore fallback). The seam declines without side
		// effects, so clearing is this caller's policy: the one place that knows the doc changed.
		if (outcome === 'unresolvable') deps.selectionState.clear();
		deps.events.emit('edit', { op, path: [], timestamp: Date.now() });
	}

	// Flush, not discard: interrupt clears the debounce timer so it can't push a stale
	// snapshot after the stack moves, AND emits the batch's pending `input` event so
	// its bytes aren't dropped from the edit channel.
	function beginHistorySwap(): void {
		deps.stickyColumn.reset();
		deps.edgeAffinity.reset();
		controller.flushDebouncedCheckpoint();
	}

	return {
		async requestUndo(): Promise<void> {
			beginHistorySwap();
			// Check the stack before capturing: captureCurrentState marks the whole tree
			// snapshot-shared, forcing copy-on-write spines on the next edit.
			if (!deps.undoManager.canUndo) return;
			const entry = deps.undoManager.undo(controller.captureCurrentState());
			if (!entry) return;
			await restore(entry, 'undo');
		},

		async requestRedo(): Promise<void> {
			beginHistorySwap();
			if (!deps.undoManager.canRedo) return;
			const entry = deps.undoManager.redo(controller.captureCurrentState());
			if (!entry) return;
			await restore(entry, 'redo');
		}
	};
}
