/**
 * Undo and redo: capture the current state for the opposite stack, install the entry's
 * snapshot, restore its selection. Snapshots share the live tree's nodes, so a restore marks
 * the tree shared again and copies the children array; otherwise a later commit would write
 * into the stack's own entry. Nothing writes while an entry is installed (G1.156).
 */

import { tick } from 'svelte';
import type { HistoryActions } from '../../action-contracts';
import type { UndoEntry } from '../../undo/types';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { checkSnapshotIntegrity } from '../../invariants/snapshot-integrity';
import { checkInstalledEntry } from '../../invariants/history-install';
import { admitsHistoryRequest } from './reading-write-gate';
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
		deps.caretLanding.noteTreeSwap();
		const generation = deps.caretLanding.generation();
		// The caret move below blurs blocks, and a block that repairs itself on blur would write.
		await deps.stamps.duringHistorySwap(() => install(entry, op));
		// Unless a later undo, redo or `source` swap has replaced the document since.
		if (deps.caretLanding.generation() !== generation) return;
		assertInvariant('history-install', () => checkInstalledEntry(op, entry.snapshot, deps.doc));
	}

	async function install(entry: UndoEntry, op: 'undo' | 'redo'): Promise<void> {
		deps.sharing.markSnapshotTaken();
		// The standing range addresses the outgoing tree; read during the render below, its path
		// could name another block in the incoming one.
		deps.selectionState.dropForDocumentSwap();
		deps.setDoc({ ...entry.snapshot, children: [...entry.snapshot.children] });
		deps.bumpContentVersion();
		// A copy: live state splices this array in place, and the entry stays on the stack.
		deps.setBlockIds([...entry.blockIds]);
		// Before the awaits below, so a host that loads another document meanwhile never hears
		// this undo after its own swap.
		deps.events.emit('edit', { op, path: [], timestamp: Date.now() });
		// The tick belongs to the document swap above, not to the restore: the new tree must
		// render before the selection restore can scroll to or address anything in it.
		await tick();
		// Into view, not held: a caret the undo put off screen comes to the nearest edge, and one
		// already on screen stays where it is.
		const outcome = await deps.caretLanding.restore(entry.selection, { reveal: 'into-view' });
		// An entry can name an index its own snapshot never had, and the restore then declines. Clear
		// here and announce it, since the swap already dropped the range without a notification.
		if (outcome === 'unresolvable') {
			deps.selectionState.batch(() => {
				deps.selectionState.clear();
				deps.selectionState.announceSelection();
			});
		}
	}

	// An open draft commits as a step the undo then takes back. The typing batch ends, so the next
	// keystroke snapshots the restored tree rather than joining an entry now on the other stack.
	async function beginHistorySwap(): Promise<void> {
		const top = deps.undoManager.peekUndo();
		deps.drafts.closeAll('undo');
		deps.caretMemory.forget();
		controller.flushDebouncedCheckpoint();
		// A draft's step renders first, so its block repaints when the undo takes the edit back.
		if (deps.undoManager.peekUndo() !== top) await tick();
	}

	return {
		async requestUndo(): Promise<void> {
			if (!admitsHistoryRequest(deps, 'undo')) return;
			await beginHistorySwap();
			// Check the stack before capturing: captureCurrentState marks the whole tree as
			// shared with a snapshot, forcing the next edit to copy its path first.
			if (!deps.undoManager.canUndo) return;
			const entry = deps.undoManager.undo(controller.captureCurrentState());
			if (!entry) return;
			await restore(entry, 'undo');
		},

		async requestRedo(): Promise<void> {
			if (!admitsHistoryRequest(deps, 'redo')) return;
			await beginHistorySwap();
			if (!deps.undoManager.canRedo) return;
			const entry = deps.undoManager.redo(controller.captureCurrentState());
			if (!entry) return;
			await restore(entry, 'redo');
		}
	};
}
