/**
 * What the editor remembers about the caret beyond its offset: the sticky column (the x a run of
 * Up/Down arrows keeps), the edge record (what overrides the character-before rule at a hidden edge),
 * the pending marks (the formats a toggle promised the next typed byte), the pending break and the
 * held space. They share one lifetime: a keydown updates them through `noteKey`, and any other caret
 * move calls `forget`, which drops them all at once.
 */

import type { EditorX } from './coordinate-spaces';
import { classifyStickyKey } from './sticky-column';
import { classifyCaretKey, type EdgeAffinity } from './edge-affinity';
import { flipMark, type PendingMarks } from './pending-marks';
import { createPendingBreak, type BlockPendingBreak } from './pending-break.svelte';
import { createHeldSpace, type HeldSpaceView } from './held-space';
import {
	createInsertionRecords,
	type HeldInsertion,
	type PlaceInsertion,
	type PreviewInsertion
} from './next-insertion';
import type { InlineMarkKind } from '../schema/inline-construct-policy';
import type { AnyCommandId } from '../schema/command-id';
import { BLOCK_MOVE_COMMAND_IDS } from '../schema/commands';
import {
	isInteractionTraceEnabled,
	traceStickyCapture,
	traceStickyReset
} from '../debug/interaction-trace';

/** The part of a keydown the classifiers read. */
export type CaretKey = Pick<KeyboardEvent, 'key'>;

export interface CaretMemory {
	/** The editor-relative x a vertical move aims for, or null outside an Up/Down run. */
	column(): EditorX | null;
	/** The record the edge resolver reads at a hidden edge; null leaves the character-before rule. */
	side(): EdgeAffinity | null;
	/** Whether the caret's last move was a navigation key (an arrow, Page, Home, End), not a click,
	 *  a write or a command. */
	arrivedByKey(): boolean;
	/** The marks a toggle at a collapsed caret promised; `forget` drops them with the rest. */
	readonly pendingMarks: PendingMarks;
	/** The line Shift+Enter at a block's end opened; `noteKey` leaves it, since the text block's
	 *  own keys decide which of them end it. */
	readonly pendingBreak: { forBlock(block: object): BlockPendingBreak };
	/** The space typed at a hidden closer while the caret still means inside; anything that names
	 *  a side ends it, a format toggle included, which leaves the construct. */
	readonly heldSpace: { forBlock(block: object): HeldSpaceView };
	/** Takes what the next insertion in `block` spends, with the caret's side and the block's move of
	 *  an insertion across a hidden edge (`place`), so a route that forgets the memory can spend them. */
	holdInsertion(block: object, place?: PlaceInsertion): HeldInsertion;
	/** What `holdInsertion` would make of an insertion, read without spending or keeping anything. */
	previewInsertion(block: object, place?: PlaceInsertion): PreviewInsertion;
	/** Grows each time what the memory answers changes, a write taking or letting go of a record
	 *  included (which asks for no paint), for a reader that caches an answer. */
	changeCount(): number;

	/** Classify a keydown; `command` is the chord's meaning at the focused block, so a rebound chord
	 *  reads as what it does. Without `measureX` (a caller holding a range) the column is kept. */
	noteKey(e: CaretKey, command: AnyCommandId | null, measureX?: () => EditorX | null): void;
	/** A committed keystroke: the next byte follows the one just typed. */
	noteTyping(): void;
	/** The next letter types outside every construct at the caret's hidden edge, until the caret
	 *  moves: a fresh start (Enter, a click past a line's end) or a typed closer. */
	noteOutside(): void;
	/** An arrow press moved the bar across a code chip's border, not the caret (`edge-step.ts`):
	 *  the next byte lands at `offset`. Called instead of `noteKey`. */
	pin(offset: number): void;
	/** Key `e` lands the caret at a code chip's edge, where the next byte goes at `offset`; noting
	 *  `e` records it, and the resolver reads it once the caret is there. */
	pinOnArrival(e: CaretKey, offset: number | null): void;
	/** Record a column a surface measured itself on the way out (the table, which has no caret
	 *  of its own at the moment it leaves). Keeps a column already held. */
	captureColumn(x: EditorX): void;
	/** A caret move that is not a key: a click, a paste, an undo, a document swap, a blur. */
	forget(): void;
}

export interface CaretMemoryDeps {
	/** Hears every change to what the memory answers, and nothing else; it may write no reactive
	 *  state, since the memory forgets during teardown. */
	onChange?: () => void;
}

export function createCaretMemory(deps: CaretMemoryDeps = {}): CaretMemory {
	let column: EditorX | null = null;
	let changes = 0;
	let side: EdgeAffinity | null = null;
	let arrivedByKey = false;
	let arriving: { key: CaretKey; offset: number } | null = null;
	let marks: ReadonlySet<InlineMarkKind> | null = null;
	const pendingBreak = createPendingBreak();
	const heldSpace = createHeldSpace();
	// Everything the next insertion spends: a new kind of record is one more entry here.
	const records = createInsertionRecords([pendingBreak, heldSpace]);

	function dropColumn(): void {
		// Runs on nearly every keystroke, so the enabled check short-circuits first.
		if (isInteractionTraceEnabled() && column !== null) traceStickyReset();
		column = null;
	}

	function captureColumn(x: EditorX): void {
		if (column !== null || !Number.isFinite(x)) return;
		column = x;
		traceStickyCapture(x);
	}

	function changed(): void {
		changes++;
		deps.onChange?.();
	}

	// Promised marks and a held space belong to one side of the caret, so a caret that changed
	// sides drops them.
	function settleSide(next: EdgeAffinity | null): void {
		const moved = !sameSide(side, next) || marks !== null;
		side = next;
		marks = null;
		if (records.end(heldSpace) || moved) changed();
	}

	return {
		column: () => column,
		side: () => side,
		arrivedByKey: () => arrivedByKey,
		pendingMarks: {
			get: () => marks,
			toggle: (kind) => {
				// The held construct's own chord is the way out of it; another chord pends its mark
				// past it, as at any caret.
				const ownChord = heldSpace.holdsInside(kind);
				records.end(heldSpace);
				if (!ownChord) marks = flipMark(marks, kind);
				changed();
			},
			consume: () => {
				const spent = marks;
				marks = null;
				if (spent) changed();
				return spent;
			},
			restore: (unspent) => {
				if (marks !== null) return;
				marks = unspent;
				changed();
			}
		},
		pendingBreak: {
			forBlock: (block) => {
				const lines = pendingBreak.forBlock(block);
				return {
					lines: lines.lines,
					at: lines.at,
					open: (line) => {
						lines.open(line);
						changed();
					},
					end: () => {
						if (records.end(pendingBreak, block)) changed();
					}
				};
			}
		},
		heldSpace: {
			forBlock: (block) => {
				const view = heldSpace.forBlock(block);
				return {
					...view,
					passCloser: (next) => {
						const passed = view.passCloser(next);
						if (passed) changed();
						return passed;
					}
				};
			}
		},
		holdInsertion: (block, place) => records.hold(block, side, place),
		previewInsertion: (block, place) => records.preview(block, side, place),
		changeCount: () => changes + records.holdChanges(),
		pinOnArrival: (e, offset) => {
			arriving = offset === null ? null : { key: e, offset };
		},
		noteKey: (e, command, measureX) => {
			// A keydown is noted twice, by the cross-block dispatch and by the block, so the pin
			// stays with its own event.
			const landing = arriving?.key === e ? arriving.offset : null;
			if (landing === null) arriving = null;
			// A block move leaves the caret where it was; the move's own commit forgets the memory.
			if (command !== null && BLOCK_MOVE_COMMAND_IDS.has(command)) return;

			const columnAction = classifyStickyKey(e.key);
			if (columnAction === 'reset') dropColumn();
			else if (columnAction === 'capture') {
				const x = measureX?.();
				if (x !== null && x !== undefined) captureColumn(x);
			}

			const keyAction = classifyCaretKey(e.key);
			// A preserved key left the caret where it was: the chord that pends a mark and the
			// character that spends it both preserve, so neither may clear the marks.
			if (keyAction === 'preserve') return;
			arrivedByKey = keyAction === 'navigate';
			settleSide(keyAction === 'navigate' && landing !== null ? { offset: landing } : null);
		},
		noteTyping: () => {
			dropColumn();
			arrivedByKey = false;
			settleSide(null);
		},
		noteOutside: () => {
			arrivedByKey = false;
			settleSide('outside');
		},
		pin: (offset) => {
			arrivedByKey = true;
			settleSide({ offset });
		},
		captureColumn,
		forget: () => {
			dropColumn();
			arrivedByKey = false;
			settleSide(null);
			if (records.end()) changed();
		}
	};
}

/** Whether two sides name the same one, a pinned offset by its value. */
function sameSide(a: EdgeAffinity | null, b: EdgeAffinity | null): boolean {
	if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
		return a.offset === b.offset;
	}
	return a === b;
}
