/**
 * One strip container kind's line syntax: how a line of a quote or list item maps to the body line
 * it holds, written once so the parser and the rebuild read a line the same way.
 */

/** Where a body line sits: on the container's opening line, or in the blank run that ends it. */
export interface LinePlace {
	first: boolean;
	trailingBlank: boolean;
}

/** A container line read as a body line. */
export interface BodyLine {
	text: string;
	/** The bytes before `text`, or null when they are no spelling to put in front of other text:
	 *  a strip that cut through a tab, or a marker still waiting for its space. */
	prefix: string | null;
	/** The line has no prefix, so it reads in the body only as a paragraph's continuation. */
	lazy: boolean;
}

export interface LineCodec {
	/** The body line `line` holds at `place`, or null when it holds none there. */
	read(line: string, place: LinePlace): BodyLine | null;
	/** `text` in the container's own spelling at `place`. */
	write(text: string, place: LinePlace): string;
}

/** A line read anywhere but a body's opening or blank-tail line. */
export const INNER_LINE: LinePlace = { first: false, trailingBlank: false };
