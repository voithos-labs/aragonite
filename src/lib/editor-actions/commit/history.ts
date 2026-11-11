/**
 * Undo and redo: capture the current state for the opposite stack, put the entry back, restore its
 * selection. A snapshot shares the live tree's nodes, so a restore marks the tree shared again; a
 * snapshot read under another grammar has its bytes read again instead of installed. Nothing
 * writes while an entry is installed (G1.156).
 */

import { tick } from 'svelte';
import type { HistoryActions } from '../../action-contracts';
import type { UndoEntry } from '../../undo/types';
import { assertInvariant, devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import { checkSnapshotIntegrity } from '../../invariants/snapshot-integrity';
import { checkInstalledEntry } from '../../invariants/history-install';
import { admitsHistoryRequest, startsAlone } from './reading-write-gate';
import { installReading } from './byte-splice';
import { byteOfGap, gapAtByte } from '../../selection/range-bytes';
import { emitEdit, NOTHING_REPLACED, type ReplacedBlocks } from './emit-edit';
import type { EditorActionsDeps, UndoController } from '../deps';
import { grammarStamp, sameGrammar } from './grammar-stamp';
import { captureChange, changeAfter } from './change-record';
import { serialize } from '../../core/serializer';
import { changesBetween } from '../../tree-operations/byte-changes';
import { runsOf, spliceReading, type SpliceReading } from '../../tree-operations/byte-splice';
import { documentByteMap } from '../../tree-operations/container-offsets';
import {
	changedRun,
	measured,
	topsOf,
	type Measured,
	type TopLevelChange
} from '../../tree-operations/top-level-starts';
import { assertRestoredUnderGrammar } from '../../invariants/install';
import { isGapSelection } from '../../selection/gap-caret';
import type { DocumentView } from '../../core/node-views';
import type { SelectionPoint } from '../../selection/primitives';

export function createHistoryActions(
	deps: EditorActionsDeps,
	controller: UndoController
): HistoryActions {
	/** `from` is the state the restore replaces, captured for the opposite stack. */
	async function restore(entry: UndoEntry, op: 'undo' | 'redo', from: UndoEntry): Promise<void> {
		assertInvariant('snapshot-integrity', () => {
			const violation = checkSnapshotIntegrity(entry);
			return violation && { ...violation, message: `${op}: ${violation.message}` };
		});
		// Before the swap itself, so a caret placement waiting across it sees the new counter
		// whichever side of the document write its scroll-into-view finishes on.
		deps.caretLanding.noteTreeSwap();
		const generation = deps.caretLanding.generation();
		// The caret move below blurs blocks, and a block that repairs itself on blur would write.
		await deps.stamps.duringHistorySwap(() => install(entry, op, from));
		// Unless a later undo, redo or `source` swap has replaced the document since.
		if (deps.caretLanding.generation() !== generation) return;
		assertInvariant('history-install', () => checkInstalledEntry(op, entry.snapshot, deps.doc));
	}

	async function install(entry: UndoEntry, op: 'undo' | 'redo', from: UndoEntry): Promise<void> {
		deps.sharing.markSnapshotTaken();
		// The standing range addresses the outgoing tree; read during the render below, its path
		// could name another block in the incoming one.
		deps.selectionState.dropForDocumentSwap();
		const capture = deps.drafts.watching() ? captureChange(deps.doc, null) : null;
		const kept = sameGrammar(entry.grammar, grammarStamp(deps.reading.grammar));
		// Read before the write's window opens, where a read would measure again.
		const reading = kept ? null : readingFor(entry);
		const { caret, replaced } = deps.starts.duringWrite(() => {
			const installed = kept ? putBack(entry, from) : readAgain(entry, reading);
			if (capture) deps.drafts.record(changeAfter(deps.doc, capture, null));
			return installed;
		});
		const selection = caret();
		// Before the awaits below, so a host that loads another document meanwhile never hears
		// this undo after its own swap.
		emitEdit(deps, { op, path: [], timestamp: Date.now() }, replaced);
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
	function putBack(entry: UndoEntry, from: UndoEntry): Installed {
		const before = devChecksOn ? new Set(deps.doc.children) : null;
		deps.setDoc({ ...entry.snapshot, children: [...entry.snapshot.children] });
		// A copy: live state splices this array in place, and the entry stays on the stack.
		deps.setBlockIds([...entry.blockIds]);
		if (before) {
			const swapped = deps.doc.children.filter((top) => !before.has(top));
			assertRestoredUnderGrammar(swapped, deps.reading.grammar, entry.grammar);
		}
		// The whole tree swaps, and naming the nodes that changed would walk it. No write runs
		// between two snapshots, so the blocks they share by identity kept their bytes.
		const to = entry.snapshot.children;
		return {
			caret: () => entry.selection,
			replaced: 'unknown',
			touched: () => [changedRun(from.snapshot.children, to, to)]
		};
	}

	/** The live document read again to the entry's bytes, since its snapshot was read under another
	 *  grammar; null when they are the same bytes. */
	function readingFor(entry: UndoEntry): Reread | null {
		const before = deps.bytes.source();
		const was = deps.bytes.measured();
		const changes = changesBetween(before, serialize(entry.snapshot));
		const reading = spliceReading(was, before, changes, deps.reading.grammar);
		return reading && { reading, was };
	}

	/** `reading` installed: the blocks the undo leaves alone keep their nodes, and the caret keeps
	 *  its byte. */
	function readAgain(entry: UndoEntry, read: Reread | null): Installed {
		const caret = selectionBytes(entry.snapshot, entry.selection);
		const replaced = read ? installReading(deps, read.reading, topsOf(read.was)) : NOTHING_REPLACED;
		assertRestoredUnderGrammar(deps.doc.children, deps.reading.grammar, entry.grammar);
		return {
			caret: () => caret && selectionAtBytes(deps.bytes.measured(), caret),
			replaced,
			touched: () => (read ? runsOf(read.reading.windows) : [])
		};
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
			if (!startsAlone(deps, { kind: 'undo' }) || !admitsHistoryRequest(deps, 'undo')) return;
			await beginHistorySwap();
			// Check the stack before capturing: captureCurrentState marks the whole tree as
			// shared with a snapshot, forcing the next edit to copy its path first.
			if (!deps.undoManager.canUndo) return;
			const from = controller.captureCurrentState();
			const entry = deps.undoManager.undo(from);
			if (!entry) return;
			await restore(entry, 'undo', from);
		},

		async requestRedo(): Promise<void> {
			if (!startsAlone(deps, { kind: 'redo' }) || !admitsHistoryRequest(deps, 'redo')) return;
			await beginHistorySwap();
			if (!deps.undoManager.canRedo) return;
			const from = controller.captureCurrentState();
			const entry = deps.undoManager.redo(from);
			if (!entry) return;
			await restore(entry, 'redo', from);
		}
	};
}

/** A reading of the live document, and the document it was read from. */
interface Reread {
	reading: SpliceReading;
	was: Measured;
}

/** An undo entry installed: where its caret goes, asked once the install is announced, the blocks
 *  the install replaced, and the runs of top-level blocks it changed. */
interface Installed {
	caret(): UndoEntry['selection'] | null;
	replaced: ReplacedBlocks;
	touched(): TopLevelChange[];
}

// ── The caret as bytes ───────────────────────────────────────────────────────

/** A selection's ends, or the gap caret's boundary, as bytes of its document. */
type SelectionBytes = { anchor: number; focus: number } | { gap: number };

function selectionBytes(
	doc: DocumentView,
	selection: UndoEntry['selection']
): SelectionBytes | null {
	// A snapshot, which nobody keeps starts for.
	const laid = measured(doc);
	const map = documentByteMap(laid);
	if (isGapSelection(selection)) {
		const gap = byteOfGap(laid, selection.gapCaret);
		return gap === null ? null : { gap };
	}
	// A table cell's index is no byte, so a cell end stands at its table's start.
	const byteOf = (point: SelectionPoint) =>
		map.byteOf(point.path, point.cellCoordinate ? 0 : point.offset);
	const focus = byteOf(selection.focus);
	if (focus === null) return null;
	return { anchor: byteOf(selection.anchor) ?? focus, focus };
}

function selectionAtBytes(laid: Measured, at: SelectionBytes): UndoEntry['selection'] | null {
	const map = documentByteMap(laid);
	if ('gap' in at) {
		const gap = gapAtByte(laid, at.gap);
		if (gap) return { gapCaret: gap };
		const leaf = map.leafAt(at.gap);
		return leaf && { anchor: leaf, focus: leaf };
	}
	const focus = map.leafAt(at.focus);
	return focus && { anchor: map.leafAt(at.anchor) ?? focus, focus };
}
