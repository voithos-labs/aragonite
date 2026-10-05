/**
 * What the editor remembers about how the caret arrived: the sticky column (the x a run of
 * Up/Down arrows keeps), the edge affinity (which side of a hidden marker run the caret means)
 * and the pending marks (the formats a toggle promised the next typed byte). All three share one
 * lifetime: a keydown updates them through `noteKey`, and any other caret move calls `forget`,
 * which drops all three at once.
 */

import type { EditorX } from './coordinate-spaces';
import { classifyStickyKey } from './sticky-column';
import { classifyArrivalKey, type EdgeAffinity } from './edge-affinity';
import { flipMark, type PendingMarks } from './pending-marks';
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

	// Promised marks belong to one side of the caret, so a caret that changed sides drops them.
	function settleSide(next: EdgeAffinity | null): void {
		side = next;
		marks = null;
	}

	return {
		column: () => column,
		side: () => side,
		pendingMarks: {
			get: () => marks,
			toggle: (kind) => {
				marks = flipMark(marks, kind);
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
		}
	};
}
