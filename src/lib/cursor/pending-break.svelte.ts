/**
 * The pending break: Shift+Enter at the end of a block's text opens an empty line and writes
 * nothing, since a backslash with no line after it is only a backslash. The first insertion on
 * that line writes the break ahead of itself; anything else ends it, so an abandoned line leaves
 * no byte behind.
 */

import type { LineEnding } from '../core/lines';
import { withHardBreak } from '../core/inline';
import { insertsAt, type InsertionRecord, type TextEdit } from './next-insertion';

export interface PendingBreak extends InsertionRecord {
	/** One block's view of the break; `block` is the identity its writes take the break with. */
	forBlock(block: object): OpenLines;
}

/** One block's open lines, without the end, which goes through the caret memory's records. */
export interface OpenLines {
	/** How many lines are open in this block: 0, or one per Shift+Enter. Reactive. */
	lines(): number;
	/** The offset the open line's caret sits at, or null when no line is open here. */
	at(): number | null;
	/** Shift+Enter at the line's end: opens a line there, or one more when one is open there. */
	open(line: BreakLine): void;
}

export interface BlockPendingBreak extends OpenLines {
	/** Ends the break when it is this block's. */
	end(): void;
}

/** Where a break's bytes go: the backslash after the text, its line ending past whatever the text's
 *  line keeps after it (a heading's closing run). */
export interface BreakLine {
	textEnd: number;
	lineEnd: number;
	ending: LineEnding;
}

interface OpenBreak extends BreakLine {
	block: object;
	count: number;
}

export function createPendingBreak(): PendingBreak {
	let open = $state.raw<OpenBreak | null>(null);

	return {
		forBlock: (block) => ({
			lines: () => (open?.block === block ? open.count : 0),
			at: () => (open?.block === block ? open.lineEnd : null),
			open: (line) => {
				const more = open?.block === block && open.lineEnd === line.lineEnd;
				open = { ...line, block, count: more ? open!.count + 1 : 1 };
			}
		}),
		take: (block) => {
			const taken = open;
			if (taken?.block !== block) return null;
			return {
				at: taken.lineEnd,
				apply: (before, edit) =>
					insertsAt(before, edit.text, taken.lineEnd) ? spent(taken, edit) : null,
				release: (waiting) => {
					if (open === taken && !waiting) open = null;
				}
			};
		},
		end: (block) => {
			// Written only when it changes: the caret memory forgets during teardown, where a write
			// to reactive state throws.
			if (open !== null && (block === undefined || open.block === block)) open = null;
		}
	};
}

/** `edit` with the break's backslash after the text and one line ending per open line before the
 *  insertion; a second line's own break is a lone backslash on it. */
function spent({ textEnd, lineEnd, ending, count }: OpenBreak, edit: TextEdit): TextEdit {
	const broken = withHardBreak(edit.text, textEnd, { start: textEnd, end: lineEnd }, ending, count);
	// The bytes the break put past the line's end, less the backslash ahead of its suffix.
	const lines = broken.lineStart - lineEnd - 1;
	const shift = (offset: number) =>
		offset + (offset > textEnd ? 1 : 0) + (offset >= lineEnd ? lines : 0);
	return { text: broken.text, caretAfter: shift(edit.caretAfter) };
}
