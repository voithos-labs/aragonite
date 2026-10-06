/**
 * The held space: a space typed at a hidden closer is written past it, since a closer can't follow
 * a space and the line would show its markers, while the caret still means inside. The next
 * insertion that isn't whitespace takes the space back inside with it; anything else ends the hold
 * and leaves the bytes as they are, already right (`docs/design/live-mode.md` § 4.2).
 */

import type { EdgeAffinity } from './edge-affinity';
import {
	insertionStart,
	type InsertionRecord,
	type Placement,
	type TextEdit
} from './next-insertion';

export interface HeldSpace extends InsertionRecord {
	/** One block's view of the hold; `block` is the identity its writes take the hold with. */
	forBlock(block: object): HeldSpaceView;
	/** Whether a space is held in any block. */
	holding(): boolean;
}

export interface HeldSpaceView {
	/** The offset the space waits to be extended or carried at: the caret's, while it holds. */
	at(): number | null;
	/** Where the next letter joins the construct, before its hidden closer, while the space holds. */
	inside(): number | null;
}

interface Hold {
	block: object;
	/** Where the space belongs: before the hidden run(s) it was written past. */
	inside: number;
	/** The space's own bytes, written past the run. */
	start: number;
	end: number;
	/** The side that held it, so the letter that carries it back is placed the same way. */
	side: EdgeAffinity | null;
}

export function createHeldSpace(): HeldSpace {
	let hold: Hold | null = null;

	return {
		forBlock: (block) => ({
			at: () => (hold?.block === block ? hold.end : null),
			inside: () => (hold?.block === block ? hold.inside : null)
		}),
		holding: () => hold !== null,
		// Taken by every write, waiting or not, since the write that types a space opens it and has
		// to keep it through its own end of the caret memory.
		take: (block) => {
			const taken = hold?.block === block ? hold : null;
			return {
				at: taken?.end ?? -1,
				apply: (before, edit, placement) => {
					const at = insertionStart(before, edit);
					if (at === null || !placement) return null;
					const typed = edit.text.slice(at, at + edit.text.length - before.length);
					if (taken && at === taken.end) {
						if (isWhitespace(typed)) {
							hold = { ...taken, end: taken.end + typed.length };
							return { ...edit, kept: true };
						}
						return carried(before, taken, typed, placement.place) ?? edit;
					}
					if (taken || !isWhitespace(typed)) return null;
					const inside = letterLandsAt(before, at, placement);
					if (inside === null || inside >= at) return null;
					hold = { block, inside, start: at, end: at + typed.length, side: placement.side };
					return { ...edit, kept: true };
				},
				release: (waiting) => {
					if (!waiting && hold?.block === block) hold = null;
				}
			};
		},
		end: (block) => {
			if (block === undefined || hold?.block === block) hold = null;
		}
	};
}

const isWhitespace = (text: string): boolean => /^[^\S\r\n]+$/.test(text);

/** Where a letter typed at `at` would be put: the side of a hidden edge the caret means. */
function letterLandsAt(before: string, at: number, { place, side }: Placement): number | null {
	const letter = { text: before.slice(0, at) + 'a' + before.slice(at), caretAfter: at + 1 };
	const placed = place(before, letter, at, side);
	return placed ? placed.caretAfter - 1 : null;
}

/** `typed` with the held space in front of it, placed as one insertion where the space was typed:
 *  inside the construct when the screen shows exactly that, else null. */
function carried(
	before: string,
	{ start, end, side }: Hold,
	typed: string,
	place: Placement['place']
): TextEdit | null {
	const space = before.slice(start, end);
	const without = before.slice(0, start) + before.slice(end);
	const run = space + typed;
	const edit = {
		text: without.slice(0, start) + run + without.slice(start),
		caretAfter: start + run.length
	};
	return place(without, edit, start, side);
}
