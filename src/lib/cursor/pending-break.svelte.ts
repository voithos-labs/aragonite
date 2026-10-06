/**
 * The pending break: Shift+Enter at the end of a block's text opens an empty line and writes
 * nothing, since a backslash with no line after it is only a backslash. The first insertion on
 * that line writes the break ahead of itself; anything else ends it, so an abandoned line leaves
 * no byte behind.
 */

import type { LineEnding } from '../core/lines';
import { insertsAt, type InsertionRecord, type TextEdit } from './next-insertion';

export interface PendingBreak extends InsertionRecord {
	/** One block's view of the break; `block` is the identity its writes take the break with. */
	forBlock(block: object): BlockPendingBreak;
}

export interface BlockPendingBreak {
	/** How many lines are open in this block: 0, or one per Shift+Enter. Reactive. */
	lines(): number;
	/** The offset the open line's caret sits at, or null when no line is open here. */
	at(): number | null;
	/** Shift+Enter at the line's end: opens a line there, or one more when one is open there. */
	open(line: BreakLine): void;
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

	const end = (): void => {
		if (open !== null) open = null;
	};

	return {
		forBlock: (block) => ({
			lines: () => (open?.block === block ? open.count : 0),
			at: () => (open?.block === block ? open.lineEnd : null),
			open: (line) => {
				const more = open?.block === block && open.lineEnd === line.lineEnd;
				open = { ...line, block, count: more ? open!.count + 1 : 1 };
			},
			end: () => {
				if (open?.block === block) open = null;
			}
		}),
		take: (block) => {
			const taken = open;
			if (taken?.block !== block) return null;
			open = null;
			return {
				at: taken.lineEnd,
				apply: (before, edit) =>
					insertsAt(before, edit.text, taken.lineEnd) ? spent(taken, edit) : null,
				restore: () => {
					open ??= taken;
				}
			};
		},
		end
	};
}

/** `edit` with the break's backslash after the text and one line ending per open line before the
 *  insertion; a second line's own break is a lone backslash on it. */
function spent({ textEnd, lineEnd, ending, count }: OpenBreak, edit: TextEdit): TextEdit {
	const lines = ending + ('\\' + ending).repeat(count - 1);
	const { text } = edit;
	const shift = (offset: number) =>
		offset + (offset > textEnd ? 1 : 0) + (offset >= lineEnd ? lines.length : 0);
	return {
		text:
			text.slice(0, textEnd) + '\\' + text.slice(textEnd, lineEnd) + lines + text.slice(lineEnd),
		caretAfter: shift(edit.caretAfter)
	};
}
