/**
 * The synchronous body every write to the document runs, a structural commit and a keystroke
 * written in place alike: the reading-mode check, the undo entry, the write with its rollback on a
 * throw, the dev checks over what it wrote, then the content version, the gap caret and `edit`.
 * Decorations read nothing while it runs (`commit-scope.ts`).
 */

import { devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import type { CommitSnapshotArg, UndoGrouping } from '../../action-contracts';
import type { ScopedOpDescriptor } from '../../schema/operations';
import type { CstNode } from '../../core/nodes';
import { asDocPath } from '../../core/coordinate-spaces';
import { beginCommit, endCommit } from '../../commit-scope';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { endsOpen } from '../../tree-operations/fix-up/apply';
import { emitCommitError, toEditEvent } from '../../editor-events';
import { emitEdit, type ReplacedBlocks } from './emit-edit';
import {
	assertChangeInReach,
	assertCommitPaths,
	assertCommittedNodes,
	assertKeepsABlock,
	assertLastLineKept,
	assertListMarkerWidths,
	assertReadsBack
} from '../../invariants/install';
import type { UndoManager } from '../../undo/types';
import { captureChange, changeAfter, type BlockReach } from './change-record';
import { admitsWrite } from './reading-write-gate';
import type { EditorActionsDeps } from '../deps';
import type { TopLevelChange } from '../../tree-operations/top-level-starts';

/** What a write hands its dev checks: `tops` are the top-level blocks holding what it wrote, so the
 *  read-back check never searches the document for them. */
export interface WrittenNodes {
	nodes: CstNode[];
	tops: CstNode[];
}

type UndoStacks = ReturnType<UndoManager['getStacks']>;

/** The undo entry a write goes into: a commit's declared grouping, or `burst` for the keystroke
 *  written in place, whose typing push already made its entry and which ends no burst. */
export type FrameHistory = UndoGrouping | 'burst';

export interface FrameWrite {
	/** Names the write in a reading-mode refusal when there is no `op`. */
	entry: string;
	/** The `edit` event, and what an `error` names; a write with no `op` announces nothing. */
	op?: ScopedOpDescriptor;
	/** Where undo puts the caret back when nothing is focused. */
	snapshot: CommitSnapshotArg;
	/** The top-level blocks the write may change, before it; absent, every one. What the open drafts
	 *  hear is read there. */
	reach?(): BlockReach | null;
	/** Where the text a keystroke typed ends, after it: a top-level block and an offset into its
	 *  blank lines and bytes. */
	typedEnd?(): { block: number; offset: number } | null;
	history: FrameHistory;
	/** Works out what the write will write, before its undo entry; false when it can't, which
	 *  writes nothing. A throw fails the write as one in `apply` does. */
	prepare?(): boolean;
	/** False when the write changed nothing; `wasOpen` is whether the document ended with no final
	 *  line break before it. */
	apply(wasOpen: boolean): boolean;
	/** Unwind a write that changed nothing, as a throw would, minus the error. */
	discardIfNoop?: boolean;
	written(): WrittenNodes;
	/** The blocks the write replaced, read once it has written. */
	replaced(): ReplacedBlocks;
	/** The runs of top-level blocks holding every byte the write changed, asked once it has
	 *  written and only while the editor keeps their starts; null when the write can't say. */
	touched(): readonly TopLevelChange[] | null;
	/** The dev checks only this write can scope, run after the frame's own. */
	check?(written: WrittenNodes): void;
	/** Restores what `apply` wrote. */
	rollback(): void;
}

/** `discarded` is a `discardIfNoop` write that changed nothing: no bytes, but a commit still lands. */
export type FrameOutcome = 'refused' | 'written' | 'discarded' | 'failed';

/** What the frame needs of the undo history, which the controller owns. */
export interface FrameUndo {
	/** End the typing burst, so the next keystroke opens its own entry. */
	endTypingBurst(): void;
	/** The stacks a rollback puts back, or null when the write pushes nothing of its own. */
	stacksToRestore(history: FrameHistory): UndoStacks | null;
	/** Push the write's entry, unless it joins one already open. */
	push(snapshot: CommitSnapshotArg, history: FrameHistory): void;
	restoreStacks(stacks: UndoStacks): void;
}

/** The one path to the `error` event for a write, so every throw site reports alike. */
export function reportWriteError(
	deps: EditorActionsDeps,
	write: Pick<FrameWrite, 'op'>,
	error: unknown
): void {
	emitCommitError(deps.events, { error, op: write.op?.kind, path: write.op?.eventPath });
}

export function createCommitFrame(
	deps: EditorActionsDeps,
	undo: FrameUndo
): (write: FrameWrite) => FrameOutcome {
	function run(write: FrameWrite): FrameOutcome {
		deps.caretMemory.forget();
		if (write.history !== 'burst') undo.endTypingBurst();
		if (devChecksOn) {
			// `invariants` imports nothing at runtime, so the number[] to DocPath conversion is here.
			assertCommitPaths(
				deps.doc,
				asDocPath(write.snapshot.path),
				write.op?.eventPath ? asDocPath(write.op.eventPath) : null
			);
		}
		// Saved before the push, which may evict the oldest entry at the cap, so a pop won't do.
		const savedStacks = undo.stacksToRestore(write.history);
		// The trailing-line fix-up can consume the document's suffix, which no write holds.
		const savedSuffix = deps.doc.suffix;
		const restore = () => {
			if (savedStacks) undo.restoreStacks(savedStacks);
			deps.doc.suffix = savedSuffix;
			write.rollback();
			deps.starts.abandoned();
		};
		let discarded = false;
		// Only while a draft is open: otherwise the write reads nothing more.
		const capture = deps.drafts.watching()
			? captureChange(deps.doc, write.reach?.() ?? null)
			: null;
		const whole = capture && devChecksOn ? captureChange(deps.doc, null) : null;
		try {
			// Inside the try: the push reads the live selection through plugin block refs.
			undo.push(write.snapshot, write.history);
			const wasOpen = endsOpen(deps.doc);
			deps.starts.opened();
			const changed = write.apply(wasOpen);
			if (write.discardIfNoop && !changed) {
				restore();
				discarded = true;
			} else if (devChecksOn) {
				const written = write.written();
				assertCommittedNodes(written.nodes, deps.reading.grammar);
				assertLastLineKept(deps.doc, wasOpen);
				assertKeepsABlock(deps.doc, written.nodes);
				assertReadsBack(written.tops, deps.reading.grammar);
				assertListMarkerWidths(written.tops);
				write.check?.(written);
			}
		} catch (err) {
			restore();
			return failed(write, err);
		}
		if (discarded) return 'discarded';
		if (capture) {
			const change = changeAfter(deps.doc, capture, write.typedEnd?.() ?? null);
			if (devChecksOn && whole) assertChangeInReach(changeAfter(deps.doc, whole, null), change);
			deps.drafts.record(change);
		}
		deps.bumpContentVersion(() => write.touched());
		// A write moves what the gap caret's boundary index names; after the push, so the stored
		// entry keeps the gap.
		deps.selectionState.clearGapCaret();
		if (write.op) {
			emitEdit(deps, toEditEvent(write.op, write.op.eventPath, Date.now()), write.replaced());
		}
		return 'written';
	}

	/** The write's `prepare`, run before anything is written: null when the write goes ahead. */
	function prepared(write: FrameWrite): FrameOutcome | null {
		try {
			return !write.prepare || write.prepare() ? null : 'refused';
		} catch (err) {
			return failed(write, err);
		}
	}

	function failed(write: FrameWrite, err: unknown): 'failed' {
		reportWriteError(deps, write, err);
		// Loud in dev; production swallows it so one failed edit does not kill the editor.
		if (devChecksOn) throw err;
		return 'failed';
	}

	function runFrame(write: FrameWrite): FrameOutcome {
		const target = write.op?.eventPath ?? write.snapshot.path;
		const op = write.op?.kind ?? write.entry;
		if (!admitsWrite(deps, op, () => blockNodeAt(deps.doc, target)?.kind)) return 'refused';
		beginCommit();
		try {
			return prepared(write) ?? run(write);
		} finally {
			endCommit();
		}
	}

	return runFrame;
}
