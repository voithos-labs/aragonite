/**
 * One strip container kind's line syntax: how a line of a quote or list item maps to the body line
 * it holds, written once so the parser and the rebuild read a line the same way.
 */

import { defaultGrammarView, lineStartsOuterBlock } from '../schema/block-openers';

/** Where a body line sits: on the container's opening line, or in the blank run that ends it. */
export interface LinePlace {
	first: boolean;
	trailingBlank: boolean;
}

/** A container line read as a body line. */
export interface BodyLine {
	text: string;
	/** The bytes before `text`, or null when the strip cut through a tab, so that no bytes of the
	 *  line stand in front of the text as they are. */
	prefix: string | null;
	/** The line has no prefix, so it reads in the body only as a paragraph's continuation. */
	lazy: boolean;
}

export interface LineCodec {
	/** The body line `line` holds at `place`, or null when it holds none there. */
	read(line: string, place: LinePlace): BodyLine | null;
	/** `text` in the container's own spelling at `place`. */
	write(text: string, place: LinePlace): string;
	/** Whether the parser takes `line`, with no prefix, as continuing a paragraph the body line
	 *  `above` leaves open; `aboveFirst` when that line is the container's opening one. */
	continuesLazily(above: string, line: string, aboveFirst: boolean): boolean;
}

/** A line read anywhere but a body's opening or blank-tail line. */
export const INNER_LINE: LinePlace = { first: false, trailingBlank: false };

/** Whether `line` opens a block at the outer level under every installed plugin, which ends a
 *  lazy continuation. */
export function opensOuterBlock(line: string): boolean {
	const parsed = { raw: line, text: line, lineEnding: '', start: 0, end: line.length };
	return lineStartsOuterBlock(parsed, { paragraphOpen: true, grammar: defaultGrammarView });
}
