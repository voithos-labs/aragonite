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
		applySelectionToDom(entry.selection, deps.selectionState, deps.getBlockElByPath);
		deps.events.emit('edit', { op, path: [], timestamp: Date.now() });
	}

	return {
		async requestUndo(): Promise<void> {
			deps.stickyColumn.reset();
			controller.clearDebouncedCheckpoint();

			const entry = deps.undoManager.undo(controller.captureCurrentState());
			if (!entry) return;
			await restore(entry, 'undo');
		},

		async requestRedo(): Promise<void> {
			deps.stickyColumn.reset();
			const entry = deps.undoManager.redo(controller.captureCurrentState());
			if (!entry) return;
			await restore(entry, 'redo');
		}
	};
}
