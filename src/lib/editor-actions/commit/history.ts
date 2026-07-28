/**
 * HistoryActions factory. requestUndo/requestRedo capture current state
 * for the swap entry, replay the entry's snapshot, and restore the saved
 * selection. Snapshots share the live tree's nodes, so a restore re-marks
 * the epoch (the restored nodes are now also held by the swap entry) and
 * re-copies the children array so later publishes never write the stack's
 * entry. Inline content is computed lazily on read, so restore parses no
 * inline — rendered blocks recompute on demand.
 */

import { tick } from 'svelte';
import type { HistoryActions } from '../../action-contracts';
import type { UndoEntry } from '../../undo/types';
import { assertInvariant } from '../../invariants/assert';
import { checkSnapshotIntegrity } from '../../invariants/snapshot-integrity';
import { restoreSelection } from '../../selection/selection-restore';
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
		deps.sharing.markSnapshotTaken();
		deps.setDoc({ ...entry.snapshot, children: [...entry.snapshot.children] });
		deps.setBlockIds(entry.blockIds);
		// The tick belongs to the doc swap above, not to the restore: the new tree
		// must render before the shared seam can reveal or address anything in it.
		await tick();
		const outcome = await restoreSelection(entry.selection, {
			getDoc: () => deps.doc,
			selectionState: deps.selectionState,
			getBlockElByPath: deps.getBlockElByPath,
			// Mount, not scroll into view: a history swap must not move the viewport for
			// a target that is already on screen. The consumer restore door promises the
			// stronger guarantee and passes the stronger primitive.
			revealTarget: async (path) => (await deps.revealPath(path)) !== null
		});
		// An entry can name a slot that never existed in its own snapshot — the
		// append-past-end op declares the one-past-the-end coordinate as its restore
		// fallback (editor-actions/focus/focus.ts) — and the swap would otherwise leave
		// the pre-swap selection painted over a document that changed underneath it.
		// The seam declines such a snapshot without side effects, which is right for the
		// consumer door (it must never disturb a live selection) and leaves this policy
		// here, where "the doc was replaced" is known.
		if (outcome === 'unresolvable') deps.selectionState.clear();
		deps.events.emit('edit', { op, path: [], timestamp: Date.now() });
	}

	// Flush any armed keystroke batch before the history swap: interrupt clears
	// the debounce timer (so it can't push a stale snapshot after the stack moves
	// underneath it) AND emits the batch's pending `input` event, so its bytes
	// aren't dropped from the edit channel — discarding lost them.
	function beginHistorySwap(): void {
		deps.stickyColumn.reset();
		controller.flushDebouncedCheckpoint();
	}

	return {
		async requestUndo(): Promise<void> {
			beginHistorySwap();
			// Check the stack before capturing: captureCurrentState marks the whole
			// tree snapshot-shared, forcing copy-on-write spines on the next edit — a
			// wasted cost when Ctrl+Z is a no-op on an empty undo stack.
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
