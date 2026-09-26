/**
 * Undo and redo: capture the current state for the opposite stack, install the entry's
 * snapshot, restore its selection. Snapshots share the live tree's nodes, so a restore marks
 * the tree shared again and copies the children array; otherwise a later commit would write
 * into the stack's own entry.
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
		// Before the swap itself, so a caret placement waiting across it sees the new counter
		// whichever side of the document write its scroll-into-view finishes on.
		controller.noteHistorySwap();
		deps.sharing.markSnapshotTaken();
		deps.setDoc({ ...entry.snapshot, children: [...entry.snapshot.children] });
		deps.bumpContentVersion();
		// A copy: live state splices this array in place, and the entry stays on the stack.
		deps.setBlockIds([...entry.blockIds]);
		// The tick belongs to the document swap above, not to the restore: the new tree must
		// render before the selection restore can scroll to or address anything in it.
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
		// An entry can name an index its own snapshot never had (append-past-end records the
		// one-past-the-end path as its fallback). The restore declines without side effects, so
		// clearing the selection is decided here, the one place that knows the document changed.
		if (outcome === 'unresolvable') deps.selectionState.clear();
		deps.events.emit('edit', { op, path: [], timestamp: Date.now() });
	}

	// Flush, not discard: `interrupt` clears the debounce timer so it cannot push a stale
	// snapshot after the stack moves, and emits the batch's pending `input` event so its
	// bytes are not dropped from the edit events.
	function beginHistorySwap(): void {
		deps.caretMemory.forget();
		controller.flushDebouncedCheckpoint();
	}

	return {
		async requestUndo(): Promise<void> {
			beginHistorySwap();
			// Check the stack before capturing: captureCurrentState marks the whole tree as
			// shared with a snapshot, forcing the next edit to copy its path first.
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
