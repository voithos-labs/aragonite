/**
 * The undo controller: the undo entries every write goes into, and the two entries of the one
 * commit frame (`commit-frame.ts`), the structural commit and the keystroke written in place. A
 * node shared with an undo snapshot stays read-only until the write copies it (G1.9).
 */

import { assertInvariant, devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import { tick } from 'svelte';
import type { Document } from '../../core/nodes';
import type { EditorSelection, Landing } from '../../selection/primitives';
import type { LandOptions } from '../../selection/caret-landing';
import type { UndoEntry } from '../../undo/types';
import type { SelectionPoint } from '../../selection/primitives';
import { digestDoc } from '../../invariants/snapshot-integrity';
import { readCurrentSelection } from '../../selection/native-bridge';
import { pathsEqual } from '../../selection/path-math';
import { checkLandingIsAValue, readCaretWhereabouts } from '../../invariants/landing-value';
import { createTextBatch } from './text-batch';
import { createStructuralCommit, type CommitArgs } from './structural-commit';
import { admitsSnapshot, admitsWrite } from './reading-write-gate';
import { createCommitFrame, reportWriteError, type FrameHistory } from './commit-frame';
import { createLeafCommit } from './leaf-commit';
import type { EditorActionsDeps, UndoController } from '../deps';
import type {
	CommitLanding,
	HeldLanding,
	CommitSnapshotArg,
	UndoGrouping
} from '../../action-contracts';
import type { DocPath } from '../../selection/path-math';
import {
	assertLineEndingPairsKept,
	documentLineEndings,
	assertUndoTopIntegrity
} from '../../invariants/install';
import {
	docByteLength,
	perfEnabled,
	recordSnapshotClone,
	setUndoGauge
} from '../../perf/instruments';

type EntrySelection = UndoEntry['selection'];

/** `announceEdit` speaks a commit's announcement in the editor's edit live region; only the
 *  controller holds it, so nothing but a commit that wrote can speak there. Silent by default. */
export function createUndoController(
	deps: EditorActionsDeps,
	announceEdit: (message: string) => void = () => {}
): UndoController {
	// ── Selection helpers ─────────────────────────────────────────────────────

	function collapsedSelectionAt(blockIndex: number, offset: number): EditorSelection {
		const point: SelectionPoint = { path: [blockIndex], offset };
		return { anchor: point, focus: point };
	}

	function collapsedSelectionAtPath(path: number[], offset: number): EditorSelection {
		const point: SelectionPoint = { path: path.slice(), offset };
		return { anchor: point, focus: point };
	}

	// ── Snapshot pushers ─────────────────────────────────────────────────────

	/** Snapshots share the live tree's nodes and copy only the top-level children array, so an
	 *  edit copies the path it writes first (G1.9, `tree-operations/unshare.ts`). */
	function shareSnapshot(): Pick<UndoEntry, 'snapshot' | 'integrity'> {
		deps.sharing.markSnapshotTaken();
		const snapshot: Document = {
			kind: 'document',
			prefix: deps.doc.prefix,
			children: [...deps.doc.children],
			suffix: deps.doc.suffix
		};
		return { snapshot, integrity: devChecksOn ? digestDoc(snapshot) : undefined };
	}

	function recordSnapshotPerf(): void {
		if (!perfEnabled()) return;
		recordSnapshotClone(docByteLength(deps.doc));
		const undo = deps.undoManager.getStacks().undo;
		let liveBytes = 0;
		for (const entry of undo) liveBytes += docByteLength(entry.snapshot);
		setUndoGauge(liveBytes, undo.length);
	}

	const readLive = () => readCurrentSelection(deps.selectionState, deps.blockRefs);

	/**
	 * What an entry records as "where the caret was". The gap caret outranks only the caller's
	 * fallback, since no block ref reports it.
	 */
	function entrySelection(fallback: () => EditorSelection): EntrySelection {
		const live = readLive();
		if (live) return live;
		const gap = deps.selectionState.gapCaret;
		return gap ? { gapCaret: gap } : fallback();
	}

	// ── Undo steps ───────────────────────────────────────────────────────────

	// The outermost open step owns these; a step inside a step adds only depth. The entry is held
	// by identity: a first write that rolls back removes it, and the next write opens it again.
	let stepDepth = 0;
	let stepEntry: UndoEntry | null = null;
	// Read when the step opens, since a gesture may collapse its range before its first write.
	let stepSelection: EntrySelection | null = null;
	let stepPushed = false;
	// Set by the author's input while a step is open; until it closes, writes push alone.
	let stepEnded = false;
	// The entry the typing batch's first keystroke went into, which a keystroke's own commit joins.
	let typingEntry: UndoEntry | null = null;
	// The entry the newest commit wrote (null when it was refused), and the one the next typing
	// write joins instead of pushing its own, until a composition or the typing batch ends.
	let lastCommitEntry: UndoEntry | null = null;
	let continued: UndoEntry | null = null;

	const inOpenStep = () => stepDepth > 0 && !stepEnded;
	const isTop = (entry: UndoEntry | null) =>
		entry !== null && deps.undoManager.peekUndo() === entry;

	const joinsStep = () => inOpenStep() && isTop(stepEntry);
	const isJoinedPush = (history: FrameHistory) =>
		(history === 'join-typing' && isTop(typingEntry)) || joinsStep();

	function pushEntry(entry: UndoEntry): void {
		continued = null;
		deps.undoManager.push(entry);
		if (inOpenStep()) {
			stepEntry = entry;
			stepPushed = true;
		}
		recordSnapshotPerf();
	}

	/** The selection a push records: the open step's, else the push's own. */
	function selectionFor(own: () => EntrySelection): EntrySelection {
		return inOpenStep() && stepSelection ? stepSelection : own();
	}

	async function undoStep(seed: CommitSnapshotArg, run: () => Promise<unknown>): Promise<void> {
		// A step opened after the author's input is a new gesture, so it groups its own writes.
		if (stepDepth === 0 || stepEnded) {
			stepEntry = null;
			stepSelection = entrySelection(() => collapsedSelectionAtPath(seed.path, seed.offset));
			stepEnded = false;
		}
		stepDepth++;
		try {
			await run();
		} finally {
			stepDepth--;
			if (stepDepth === 0) {
				// The next keystroke starts its own entry rather than joining the gesture's.
				if (stepPushed && !stepEnded) textBatch.interrupt();
				stepEntry = null;
				stepSelection = null;
				stepPushed = false;
				stepEnded = false;
			}
		}
	}

	function endUndoStep(): void {
		if (stepDepth === 0) return;
		stepEnded = true;
		stepEntry = null;
	}

	function continueTypingBurst(): void {
		continued = lastCommitEntry;
	}

	function typingKeystroke<T>(
		leafPath: DocPath,
		preEditOffset: number,
		batchKey: string,
		history: UndoGrouping,
		work: () => Promise<T>
	): Promise<T> {
		burstStacks = null;
		// An entry of its own ends the burst on both sides, so one Ctrl+Z takes it back alone.
		if (history === 'entry') textBatch.interrupt();
		if (admitsSnapshot(deps)) textBatch.keystroke(leafPath, preEditOffset, batchKey);
		if (history === 'entry') textBatch.interrupt();
		// A batch whose pause timer never started never ends on a pause, so the timer starts even
		// when the keystroke's work throws.
		return work().finally(textBatch.armPause);
	}

	// ── Entry pushes ─────────────────────────────────────────────────────────

	// A push inside a step after its first returns before the snapshot, so it neither marks the
	// tree shared nor clears the redo stack.
	function pushCommitSnapshot(fallbackPath: number[], offset: number, history: FrameHistory): void {
		if (isJoinedPush(history) || !admitsSnapshot(deps)) return;
		pushEntry({
			...shareSnapshot(),
			blockIds: [...deps.blockIds],
			selection: selectionFor(() =>
				entrySelection(() => collapsedSelectionAtPath(fallbackPath, offset))
			)
		});
	}

	// Path from the live focused leaf, offset from the caller: the live caret is already
	// past the edit, but its path still points at the same leaf.
	function pushTypingSnapshot(leafPath: number[], offset: number): void {
		const joins = continued;
		continued = null;
		if (isTop(joins)) {
			typingEntry = joins;
			return;
		}
		if (joinsStep()) {
			typingEntry = stepEntry;
			return;
		}
		const selection = selectionFor(() => {
			const live = readLive();
			const liveIsCollapsed =
				!!live &&
				pathsEqual(live.anchor.path, live.focus.path) &&
				live.anchor.offset === live.focus.offset;
			return liveIsCollapsed
				? collapsedSelectionAtPath(live.anchor.path, offset)
				: collapsedSelectionAtPath(leafPath, offset);
		});
		const entry = { ...shareSnapshot(), blockIds: [...deps.blockIds], selection };
		burstStacks = deps.undoManager.getStacks();
		pushEntry(entry);
		typingEntry = entry;
	}

	const textBatch = createTextBatch({
		pushSnapshot: pushTypingSnapshot,
		onEnd: () => {
			continued = null;
		}
	});

	// ── The commit frame ──────────────────────────────────────────────────────

	// The stacks from before the current keystroke's typing push, when that push opened an entry:
	// what a keystroke rolled back in place puts back.
	let burstStacks: ReturnType<typeof deps.undoManager.getStacks> | null = null;

	const runFrame = createCommitFrame(deps, {
		endTypingBurst: textBatch.interrupt,
		stacksToRestore: (history) => {
			if (history === 'burst') return burstStacks;
			return isJoinedPush(history) ? null : deps.undoManager.getStacks();
		},
		push: (snapshot, history) => {
			if (history === 'burst') return;
			pushCommitSnapshot(snapshot.path, snapshot.offset, history);
			lastCommitEntry = deps.undoManager.peekUndo() ?? null;
		},
		restoreStacks: (stacks) => {
			deps.undoManager.restoreStacks(stacks);
			// The entry the burst opened is gone, so the next keystroke opens it again.
			textBatch.interrupt();
		}
	});

	/** The commit's landing, checked in dev to have moved no caret while it was read. */
	function readLanding(landing: CommitLanding | undefined): Landing | null {
		if (!landing) return null;
		if (!devChecksOn) return landing();
		const before = readCaretWhereabouts();
		const value = landing();
		assertInvariant('landing-is-a-value', () =>
			checkLandingIsAValue(before, readCaretWhereabouts())
		);
		return value;
	}

	// Resolves to whether bytes landed; the frame runs before the first await.
	async function __commit(args: CommitArgs): Promise<boolean> {
		lastCommitEntry = null;
		// Read before any await, so an undo or swap during the landing's mount makes it give up.
		const stamp = deps.caretLanding.generation();
		let endings: ReturnType<typeof documentLineEndings> = null;
		const outcome = runFrame({
			...args,
			apply: (wasOpen) => {
				endings = documentLineEndings(deps.doc);
				return args.apply(wasOpen);
			},
			check: () => {
				assertLineEndingPairsKept(deps.doc, endings);
				// A missed copy before write corrupts the newest undo entry, so the commit catches it
				// rather than some distant undo (G1.9). Never throws.
				assertUndoTopIntegrity(deps.undoManager.peekUndo() ?? undefined);
			}
		});
		// A refused write lands nothing, while a discarded no-op still lands.
		if (outcome === 'refused' || outcome === 'failed') return false;
		await tick();
		// Awaited, so the promise every caller holds means "the caret is placed". No rollback on a
		// throw: the commit succeeded and the tree is correct, so it is reported and the next runs.
		try {
			const landing = readLanding(args.landing);
			const placement = landing && placementOf(args, landing, stamp);
			if (placement && heldDepth > 0) held = placement;
			else if (placement) await placement.place();
		} catch (err) {
			reportWriteError(deps, args, err);
		}
		if (outcome !== 'written') return false;
		if (args.announce) announceEdit(args.announce());
		return true;
	}

	function placementOf(args: CommitArgs, landing: Landing, stamp: number): HeldLanding {
		const opts: LandOptions = { stamp, reveal: args.reveal };
		return {
			async place() {
				try {
					if ('anchor' in landing) await deps.caretLanding.restore(landing, opts);
					else await deps.caretLanding.land(landing, opts);
				} catch (err) {
					reportWriteError(deps, args, err);
				}
			}
		};
	}

	// ── Held landings ────────────────────────────────────────────────────────

	// While a hold runs, a commit keeps its caret here instead of putting it down; the newest wins.
	let heldDepth = 0;
	let held: HeldLanding | null = null;

	async function holdLandings<T>(run: () => Promise<T>): Promise<[T, HeldLanding | null]> {
		const outer = held;
		held = null;
		heldDepth++;
		try {
			const result = await run();
			return [result, held];
		} finally {
			heldDepth--;
			held = outer;
		}
	}

	const { commitStructural, commitContainerStructural, commitMultiScope, getDocScope } =
		createStructuralCommit(deps, __commit);

	// ── State capture / checkpoint control ──────────────────────────────────

	function captureCurrentState(): UndoEntry {
		// The same selection read as the snapshot pushes: this is the entry an undo or redo
		// pushes onto the opposite stack, so a gap caret or a selected image's caret survives.
		return {
			...shareSnapshot(),
			blockIds: [...deps.blockIds],
			// Fallback when nothing is focused (a headless harness, a programmatic capture).
			selection: entrySelection(() => collapsedSelectionAt(0, 0))
		};
	}

	return {
		typingKeystroke,
		typeLeaf: createLeafCommit(deps, runFrame),
		commitStructural,
		commitContainerStructural,
		commitMultiScope,
		getDocScope,
		captureCurrentState,
		flushDebouncedCheckpoint: textBatch.interrupt,
		undoStep,
		endUndoStep,
		continueTypingBurst,
		endContinuedBurst: () => {
			continued = null;
		},
		holdLandings,
		// The snapshot's answer is the write gate's, with no warning.
		admitsGesture: (op) => (op === null ? admitsSnapshot(deps) : admitsWrite(deps, op))
	};
}
