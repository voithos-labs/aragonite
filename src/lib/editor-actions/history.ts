/**
 * HistoryActions factory. requestUndo/requestRedo capture current state
 * for the swap entry, replay the entry's snapshot, and restore the saved
 * selection. Snapshots share the live tree's nodes, so a restore re-marks
 * the epoch (the restored nodes are now also held by the swap entry) and
 * re-copies the children array so later publishes never write the stack's
 * entry. Inline caches repopulate via the shell sweep on the emitted
 * undo/redo event.
 */

import { tick } from 'svelte';
import type { HistoryActions } from '../action-contracts';
import type { UndoEntry } from '../undo/types';
import { assertInvariant } from '../invariants/assert';
import { checkSnapshotIntegrity } from '../invariants/snapshot-integrity';
import { applySelectionToDom } from '../selection/native-bridge';
import type { EditorActionsDeps, UndoController } from './deps';

export function createHistoryActions(
	deps: EditorActionsDeps,
	controller: UndoController
): HistoryActions {
	async function restore(entry: UndoEntry, op: 'undo' | 'redo'): Promise<void> {
		assertInvariant('snapshot-integrity', () => {
			const violation = checkSnapshotIntegrity(entry);
			return violation && { ...violation, message: `${op}: ${violation.message}` };
		});
		deps.sharing.markSnapshotTaken();
		deps.setDoc({ ...entry.snapshot, children: [...entry.snapshot.children] });
		deps.setBlockIds(entry.blockIds);
		await tick();
		// Mount the focus block if it scrolled out of the window; applySelectionToDom
		// still does the placement via getBlockElByPath, which now resolves.
		await deps.revealPath(entry.selection.focus.path);
		applySelectionToDom(entry.selection, deps.selectionState, deps.getBlockElByPath);
		deps.events.emit('edit', { op, path: [], timestamp: Date.now() });
	}

	// Drop any armed keystroke batch before the history swap so its debounce
	// timer can't push a stale snapshot after the stack moves underneath it.
	function beginHistorySwap(): void {
		deps.stickyColumn.reset();
		controller.clearDebouncedCheckpoint();
	}

	return {
		async requestUndo(): Promise<void> {
			beginHistorySwap();
			const entry = deps.undoManager.undo(controller.captureCurrentState());
			if (!entry) return;
			await restore(entry, 'undo');
		},

		async requestRedo(): Promise<void> {
			beginHistorySwap();
			const entry = deps.undoManager.redo(controller.captureCurrentState());
			if (!entry) return;
			await restore(entry, 'redo');
		}
	};
}
