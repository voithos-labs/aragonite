/**
 * One strip container kind's line syntax: how a line of a quote or list item maps to the body line
 * it holds, written once so the parser and the rebuild read a line the same way.
 */

import {
	defaultGrammarView,
	lineInterruptsParagraph,
	lineStartsOuterBlock
} from '../schema/block-openers';
import { indentColumns, isBlankLine, stripIndentColumns } from './lines';

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

/** A line-prefixed container's line syntax, which its parser and `rebuildStripRaw` both read. */
export interface LineCodec {
	/** The body line `line` holds at `place`, or null when it holds none there. */
	read(line: string, place: LinePlace): BodyLine | null;
	/** `text` in the container's own spelling at `place`. */
	write(text: string, place: LinePlace): string;
	/** Whether `line` is {@link write}'s spelling of `text` at `place` and reads back as `text`,
	 *  answered without reading `line`; false whenever unsure. */
	spells(line: string, text: string, place: LinePlace): boolean;
	/** Whether the parser takes `line`, with no prefix, as continuing a paragraph the body line
	 *  `above` leaves open; `aboveFirst` when that line is the container's opening one. */
	continuesLazily(above: string, line: string, aboveFirst: boolean): boolean;
}

/** A line read anywhere but a body's opening or blank-tail line. */
export const INNER_LINE: LinePlace = { first: false, trailingBlank: false };

/** A body's opening line. */
export const FIRST_LINE: LinePlace = { first: true, trailingBlank: false };

/** Whether `line` opens a block at the outer level under every installed plugin, which ends a
 *  lazy continuation. */
export function opensOuterBlock(line: string): boolean {
	const parsed = { raw: line, text: line, lineEnding: '', start: 0, end: line.length };
	return lineStartsOuterBlock(parsed, { paragraphOpen: true, grammar: defaultGrammarView });
}

/** A container written like a list item: a marker opening its first line, every other line
 *  indented to one column. */
export interface HangingIndent {
	/** The marker the rebuild writes at the start of the first line. */
	opener: string;
	/** The column every later line's text starts at, a tab reaching the next multiple of four. */
	column: number;
	/** The marker `line` opens with, read the way the parser reads it, or null when it opens no
	 *  such container. */
	readOpener: (line: string) => string | null;
	/** Whether the parser takes `line` as continuing the paragraph `above` leaves open; by default
	 *  when neither is blank or interrupts a paragraph, and `line` opens no block. */
	continuesLazily?: LineCodec['continuesLazily'];
}

/** The line syntax of a container written like a list item: a blank separator stays bare, and a
 *  blank line ending the body is indented, or a reload would read it outside the container. */
export function hangingIndentLines(shape: HangingIndent): LineCodec {
	const { opener, column, readOpener } = shape;
	const pad = ' '.repeat(column);
	return {
		read(line, place) {
			if (place.first) {
				const prefix = readOpener(line);
				return prefix === null ? null : { text: line.slice(prefix.length), prefix, lazy: false };
			}
			const text = stripIndentColumns(line, column);
			if (indentColumns(line) >= column) {
				const cut = line.length - text.length;
				// Compared as a slice: V8's `endsWith` steps through the text a character at a time.
				const prefix = cut >= 0 && line.slice(cut) === text ? line.slice(0, cut) : null;
				return { text, prefix, lazy: false };
			}
			// Below the content column a blank line still separates, but can't end the body.
			if (isBlankLine(line))
				return place.trailingBlank ? null : { text, prefix: line, lazy: false };
			return { text, prefix: line.slice(0, line.length - text.length), lazy: true };
		},
		write(text, place) {
			if (place.first) return opener + text;
			return text === '' && !place.trailingBlank ? '' : pad + text;
		},
		spells(line, text, place) {
			// The opening line is read for its marker, which the text after it can change.
			if (place.first) return false;
			if (text === '' && !place.trailingBlank) return line === '';
			return (
				line.length === column + text.length &&
				line.startsWith(pad) &&
				line.slice(column) === text &&
				!(column % 4 !== 0 && leadingTab(text))
			);
		},
		continuesLazily:
			shape.continuesLazily ??
			((above, line) => keepsParagraph(above) && keepsParagraph(line) && !opensOuterBlock(line))
	};
}

/** CommonMark's paragraph continuation, read per line: not blank, and not a paragraph interrupter. */
const keepsParagraph = (text: string): boolean =>
	!isBlankLine(text) && !lineInterruptsParagraph(text);

/** Whether a tab sits in `text`'s leading whitespace, which a read at a column off the tab stops
 *  rewrites as spaces. */
function leadingTab(text: string): boolean {
	for (let i = 0; text[i] === ' ' || text[i] === '\t'; i++) if (text[i] === '\t') return true;
	return false;
}
