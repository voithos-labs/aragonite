/**
 * Undo and redo: capture the current state for the opposite stack, put the entry back, restore its
 * selection. A snapshot shares the live tree's nodes, so a restore marks the tree shared again; a
 * snapshot read under another grammar has its bytes read again instead of installed. Nothing
 * writes while an entry is installed (G1.156).
 */

import { tick } from 'svelte';
import type { HistoryActions } from '../../action-contracts';
import type { UndoEntry } from '../../undo/types';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { checkSnapshotIntegrity } from '../../invariants/snapshot-integrity';
import { checkInstalledEntry } from '../../invariants/history-install';
import { admitsHistoryRequest } from './reading-write-gate';
import { gapAtByte, installReading } from './byte-splice';
import type { EditorActionsDeps, UndoController } from '../deps';
import { grammarStamp, sameGrammar } from './grammar-stamp';
import { serialize } from '../../core/serializer';
import { changesBetween, spliceReading } from '../../tree-operations/byte-splice';
import { documentByteMap } from '../../tree-operations/container-offsets';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { assertRestoredUnderGrammar } from '../../invariants/install';
import { isGapSelection, type GapCaretPosition } from '../../selection/gap-caret';
import type { DocumentView } from '../../core/node-views';
import type { SelectionPoint } from '../../selection/primitives';

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
		const selection = sameGrammar(entry.grammar, grammarStamp(deps.reading.grammar))
			? putBack(entry)
			: readAgain(entry);
		deps.bumpContentVersion();
		// Before the awaits below, so a host that loads another document meanwhile never hears
		// this undo after its own swap.
		deps.events.emit('edit', { op, path: [], timestamp: Date.now() });
		// The tick belongs to the document swap above, not to the restore: the new tree must
		// render before the selection restore can scroll to or address anything in it.
		await tick();
		// Into view, not held: a caret the undo put off screen comes to the nearest edge, and one
		// already on screen stays where it is.
		const outcome = selection
			? await deps.caretLanding.restore(selection, { reveal: 'into-view' })
			: 'unresolvable';
		// An entry can name an index its own snapshot never had, and the restore then declines. Clear
		// here and announce it, since the swap already dropped the range without a notification.
		if (outcome === 'unresolvable') {
			deps.selectionState.batch(() => {
				deps.selectionState.clear();
				deps.selectionState.announceSelection();
			});
		}
	}

	/** The entry's snapshot, installed as it stands: the editor still reads the grammar it was read under. */
	function putBack(entry: UndoEntry): UndoEntry['selection'] {
		const before = new Set(deps.doc.children);
		deps.setDoc({ ...entry.snapshot, children: [...entry.snapshot.children] });
		// A copy: live state splices this array in place, and the entry stays on the stack.
		deps.setBlockIds([...entry.blockIds]);
		assertRestoredUnderGrammar(
			deps.doc.children.filter((top) => !before.has(top)),
			deps.reading.grammar
		);
		return entry.selection;
	}

	/** The live document read again to the entry's bytes, since its snapshot was read under another
	 *  grammar; the blocks the undo leaves alone keep their nodes, and the caret keeps its byte. */
	function readAgain(entry: UndoEntry): UndoEntry['selection'] | null {
		const caret = selectionBytes(entry.snapshot, entry.selection);
		const live = serialize(deps.doc);
		const changes = changesBetween(live, serialize(entry.snapshot));
		const reading = spliceReading(deps.doc, live, changes, deps.reading.grammar);
		if (reading) installReading(deps, reading);
		assertRestoredUnderGrammar(deps.doc.children, deps.reading.grammar);
		return caret && selectionAtBytes(deps.doc, caret);
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

// ── The caret as bytes ───────────────────────────────────────────────────────

/** A selection's ends, or the gap caret's boundary, as bytes of its document. */
type SelectionBytes = { anchor: number; focus: number } | { gap: number };

function selectionBytes(
	doc: DocumentView,
	selection: UndoEntry['selection']
): SelectionBytes | null {
	const map = documentByteMap(doc);
	if (isGapSelection(selection)) {
		const gap = gapByte(doc, selection.gapCaret);
		return gap === null ? null : { gap };
	}
	// A table cell's index is no byte, so a cell end stands at its table's start.
	const byteOf = (point: SelectionPoint) =>
		map.byteOf(point.path, point.cellCoordinate ? 0 : point.offset);
	const focus = byteOf(selection.focus);
	if (focus === null) return null;
	return { anchor: byteOf(selection.anchor) ?? focus, focus };
}

/** Where a block starts, or where its container ends past its last child. */
function gapByte(doc: DocumentView, { parentPath, index }: GapCaretPosition): number | null {
	const map = documentByteMap(doc);
	const parent = parentPath.length === 0 ? doc : blockNodeAt(doc, parentPath);
	if (!parent?.children) return null;
	if (index < parent.children.length) return map.byteOf([...parentPath, index], 0);
	if (parentPath.length === 0) return serialize(doc).length;
	return map.byteOf(parentPath, (parent as { raw: string }).raw.length);
}

function selectionAtBytes(doc: DocumentView, at: SelectionBytes): UndoEntry['selection'] | null {
	const map = documentByteMap(doc);
	if ('gap' in at) {
		const gap = gapAtByte(doc, at.gap);
		if (gap) return { gapCaret: gap };
		const leaf = map.leafAt(at.gap);
		return leaf && { anchor: leaf, focus: leaf };
	}
	const focus = map.leafAt(at.focus);
	return focus && { anchor: map.leafAt(at.anchor) ?? focus, focus };
}
