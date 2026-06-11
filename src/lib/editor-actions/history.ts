/**
 * HistoryActions factory. requestUndo/requestRedo capture current state
 * for the redo swap, replay the entry's snapshot, and restore the saved
 * selection. Inline caches repopulate via the shell sweep on the emitted
 * undo/redo event — snapshots are cache-less (cloneDocument drops them).
 */

import { tick } from 'svelte';
import type { HistoryActions } from '../action-contracts';
import { applySelectionToDom } from '../selection/native-bridge';
import type { EditorActionsDeps, UndoController } from './deps';

export function createHistoryActions(
	deps: EditorActionsDeps,
	controller: UndoController
): HistoryActions {
	return {
		async requestUndo(): Promise<void> {
			deps.stickyColumn.reset();
			controller.clearDebouncedCheckpoint();

			const entry = deps.undoManager.undo(controller.captureCurrentState());
			if (!entry) return;
			deps.setDoc(entry.snapshot);
			deps.setBlockIds(entry.blockIds);
			await tick();
			applySelectionToDom(entry.selection, deps.selectionState, deps.getBlockElByPath);
			deps.events.emit('edit', { op: 'undo', path: [], timestamp: Date.now() });
		},

		async requestRedo(): Promise<void> {
			deps.stickyColumn.reset();
			const entry = deps.undoManager.redo(controller.captureCurrentState());
			if (!entry) return;
			deps.setDoc(entry.snapshot);
			deps.setBlockIds(entry.blockIds);
			await tick();
			applySelectionToDom(entry.selection, deps.selectionState, deps.getBlockElByPath);
			deps.events.emit('edit', { op: 'redo', path: [], timestamp: Date.now() });
		}
	};
}
