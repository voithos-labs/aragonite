/**
 * What the editor remembers about how the caret arrived: the sticky column (the x a run of
 * Up/Down arrows keeps), the edge affinity (which side of a hidden marker run the caret means), the
 * pending marks (the formats a toggle promised the next typed byte), the pending break and the held
 * space. They share one lifetime: a keydown updates them through `noteKey`, and any other caret
 * move calls `forget`, which drops them all at once.
 */

import type { EditorX } from './coordinate-spaces';
import { classifyStickyKey } from './sticky-column';
import { classifyArrivalKey, type EdgeAffinity } from './edge-affinity';
import { flipMark, type PendingMarks } from './pending-marks';
import { createPendingBreak, type BlockPendingBreak } from './pending-break.svelte';
import { createHeldSpace, type HeldSpaceView } from './held-space';
import { createInsertionRecords, type HeldInsertion, type PlaceInsertion } from './next-insertion';
import type { InlineMarkKind } from '../schema/inline-construct-policy';
import type { AnyCommandId } from '../schema/command-id';
import { BLOCK_MOVE_COMMAND_IDS } from '../schema/commands';
import {
	isInteractionTraceEnabled,
	traceStickyCapture,
	traceStickyReset
} from '../debug/interaction-trace';

/** The parts of a keydown the classifiers read. */
export type ArrivalKey = Pick<KeyboardEvent, 'key'> & Partial<Pick<KeyboardEvent, 'metaKey'>>;

export interface CaretMemory {
	/** The editor-relative x a vertical move aims for, or null outside an Up/Down run. */
	column(): EditorX | null;
	/** Which side of a hidden marker run the caret means; null leaves the typing path's default. */
	side(): EdgeAffinity | null;
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

	/** Classify a keydown; `command` is the chord's meaning at the focused block, so a rebound chord
	 *  reads as what it does. Without `measureX` (a caller holding a range) the column is kept. */
	noteKey(e: ArrivalKey, command: AnyCommandId | null, measureX?: () => EditorX | null): void;
	/** A committed keystroke: the byte belongs to the content, whatever arrival preceded it. */
	noteTyping(): void;
	/** The caret was placed at an end rather than stepped there, so it means the outside. */
	noteExtreme(): void;
	/** An arrow press moved the side, not the caret (`edge-step.ts`): the next byte lands at
	 *  `offset`. Called instead of `noteKey`, since the key took no step to classify. */
	pin(offset: number): void;
	/** Record a column a surface measured itself on the way out (the table, which has no caret
	 *  of its own at the moment it leaves). Keeps a column already held. */
	captureColumn(x: EditorX): void;
	/** A caret move that is not a key: a click, a paste, an undo, a document swap, a blur. */
	forget(): void;
}

export function createCaretMemory(): CaretMemory {
	let column: EditorX | null = null;
	let side: EdgeAffinity | null = null;
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

	// Promised marks and a held space belong to one side of the caret, so a caret that changed
	// sides drops them.
	function settleSide(next: EdgeAffinity | null): void {
		side = next;
		marks = null;
		records.end(heldSpace);
	}

	return {
		column: () => column,
		side: () => side,
		pendingMarks: {
			get: () => marks,
			toggle: (kind) => {
				// Over a held space the chord leaves the construct the caret was in, and pends nothing.
				if (heldSpace.holding()) records.end(heldSpace);
				else marks = flipMark(marks, kind);
			},
			consume: () => {
				const spent = marks;
				marks = null;
				return spent;
			},
			restore: (unspent) => {
				if (marks === null) marks = unspent;
			}
		},
		pendingBreak: {
			forBlock: (block) => ({
				...pendingBreak.forBlock(block),
				end: () => records.end(pendingBreak, block)
			})
		},
		heldSpace,
		holdInsertion: (block, place) => records.hold(block, side, place),
		noteKey: (e, command, measureX) => {
			// A block move leaves the caret where it was; the move's own commit forgets the memory.
			if (command !== null && BLOCK_MOVE_COMMAND_IDS.has(command)) return;

			const columnAction = classifyStickyKey(e.key);
			if (columnAction === 'reset') dropColumn();
			else if (columnAction === 'capture') {
				const x = measureX?.();
				if (x !== null && x !== undefined) captureColumn(x);
			}

			const sideAction = classifyArrivalKey(e.key, e.metaKey);
			// A preserved key left the caret where it was: the chord that pends a mark and the
			// character that spends it both preserve, so neither may clear the marks.
			if (sideAction === 'preserve') return;
			settleSide(sideAction === 'reset' ? null : sideAction);
		},
		noteTyping: () => {
			dropColumn();
			settleSide('near');
		},
		noteExtreme: () => settleSide('outside'),
		pin: (offset) => settleSide({ offset }),
		captureColumn,
		forget: () => {
			dropColumn();
			settleSide(null);
			records.end();
		}
	};
}
