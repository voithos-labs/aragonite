/**
 * HistoryActions factory. requestUndo/requestRedo capture current state
 * for the redo swap, replay the entry's snapshot, re-parse inline content,
 * and restore the saved selection.
 */

import { tick } from 'svelte';
import type { HistoryActions } from '../contracts';
import { applySelectionToDom } from '../selection/native-bridge';
import { parseAllInlineContent } from '../core/inline';
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
			parseAllInlineContent(deps.doc.children);
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
			parseAllInlineContent(deps.doc.children);
			deps.setBlockIds(entry.blockIds);
			await tick();
			applySelectionToDom(entry.selection, deps.selectionState, deps.getBlockElByPath);
			deps.events.emit('edit', { op: 'redo', path: [], timestamp: Date.now() });
		}
	};
}
