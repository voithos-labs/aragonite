/**
 * A container's line shape, stated as data, and the line syntax derived from it: how a line of a
 * quote or list item maps to the body line it holds, so the parser and the writer read it alike.
 */

import type { CstNode } from './nodes';
import { lineStartsOuterBlock, type GrammarView } from '../schema/block-openers';
import type { ChildRawChange } from '../schema/child-spans';
import type { StripRebuild } from '../schema/strip-rebuild';
import type { FencedReading } from '../schema/fence-shape';
import { indentColumns, isBlankLine, stripIndentColumns } from './lines';

// ── Line shapes ──────────────────────────────────────────────────────────────

/** How a container's lines are written; the editor writes its bytes from this and its children. */
export type LineShape<D extends object = never> =
	MarkedLines | HeadedLines<D> | IndentedLines<D> | FencedLines<D> | ColonLines;

/** A marker on every line (a quote, an alert); a line with no text drops the marker's last space. */
export interface MarkedLines {
	shape: 'marked';
	first: string;
	rest: string;
	/** The marker as read at a line's start; it reads all of `first` and `rest`, and nothing more. */
	reads: RegExp;
	/** Whether a line with no marker still continues a paragraph left open above it. */
	lazy: boolean;
}

/** Marked lines under a first line that holds no child (`> [!NOTE]`), read after the marker;
 *  `headedLines` makes one. */
export interface HeadedLines<D extends object> extends MarkedLines {
	head: { match: RegExp; data(match: RegExpExecArray): D; write(data: D): string };
	readonly [WRITES_LINES]: ShapeWriter;
}

/** A marker on the first line and an indent on the rest (a list item, a footnote definition). */
export interface IndentedLines<D extends object> {
	shape: 'indented';
	/** The first line's marker, read at the line's start. */
	open: RegExp;
	data(match: RegExpExecArray): D;
	first(data: D): string;
	/** Spaces only: their width is the column a later line's text starts at, a tab reaching the
	 *  next multiple of four. */
	rest(data: D): string;
	lazy: boolean;
	/** First-line text ahead of the child's that a lazy line's paragraph rule reads (a task box). */
	paragraphHead?(data: D): string;
}

/** The writer a headed, fenced or colon shape brings along, so an app that never uses one doesn't
 *  ship it. */
export const WRITES_LINES = Symbol('writes the container');

export type ShapeWriter = (
	node: CstNode,
	grammar: GrammarView,
	changed?: ChildRawChange
) => StripRebuild | void;

/** An opening line, a title line if it has one, and a closing line around the body (`<details>`),
 *  the title line's title as child 0; `fencedLines` makes one. */
export interface FencedLines<D extends object> {
	shape: 'fenced';
	readonly [WRITES_LINES]: ShapeWriter;
	readonly [READS_LINES]: FencedReading<D>;
}

/** The reader a fenced shape brings along, so an app that never uses one doesn't ship it. */
export const READS_LINES = Symbol('reads the container');

/** A `:::name` fence around the body, the opener line as child 0. */
export interface ColonLines {
	shape: 'colon';
	readonly [WRITES_LINES]: ShapeWriter;
}

/** The shapes whose every line reads through a line syntax. */
export type StripShape<D extends object> = MarkedLines | IndentedLines<D>;

// ── Line syntax ──────────────────────────────────────────────────────────────

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
	/** Whether `grammar` takes `line`, with no prefix, as continuing a paragraph the body line
	 *  `above` leaves open; `aboveFirst` when that line is the container's opening one. */
	continuesLazily(above: string, line: string, aboveFirst: boolean, grammar: GrammarView): boolean;
	/** Whether the lines of a body emptied of its text keep their markers as spelled (a quote's
	 *  `> `), where a blank line is otherwise written the container's way. */
	blankKeepsMarker?: boolean;
}

/** A line read anywhere but a body's opening or blank-tail line. */
export const INNER_LINE: LinePlace = { first: false, trailingBlank: false };

/** A body's opening line. */
export const FIRST_LINE: LinePlace = { first: true, trailingBlank: false };

/** The line syntax `shape` states, its markers written from `data`. */
export function codecFromShape<D extends object>(shape: StripShape<D>, data?: D): LineCodec {
	return shape.shape === 'marked' ? markedCodec(shape) : indentedCodec(shape, data as D);
}

/** Whether a body line holding `text` leaves a paragraph open for a lazy line, read per line: not
 *  blank, not the shape's own marker, and nothing `grammar` lets interrupt a paragraph. */
export function keepsParagraphOpen<D extends object>(
	shape: StripShape<D>,
	text: string,
	grammar: GrammarView
): boolean {
	const own = shape.shape === 'marked' ? shape.reads : shape.open;
	return !isBlankLine(text) && !own.test(text) && !grammar.interruptsParagraph(text);
}

/** Whether `line` opens a block at the outer level, which ends a lazy continuation. */
function opensOuterBlock(line: string, grammar: GrammarView): boolean {
	const parsed = { raw: line, text: line, lineEnding: '', start: 0, end: line.length };
	return lineStartsOuterBlock(parsed, { paragraphOpen: true, grammar });
}

// A marked shape holds no data, so its syntax is derived once.
const markedCodecs = new WeakMap<object, LineCodec>();

function markedCodec(shape: MarkedLines): LineCodec {
	const known = markedCodecs.get(shape);
	if (known) return known;
	const write = (text: string, place: LinePlace): string => {
		const marker = place.first ? shape.first : shape.rest;
		return text === '' ? marker.trimEnd() : marker + text;
	};
	const codec: LineCodec = {
		read(line, place) {
			const prefix = shape.reads.exec(line)?.[0];
			if (prefix !== undefined) return { text: line.slice(prefix.length), prefix, lazy: false };
			if (!shape.lazy || place.first || isBlankLine(line)) return null;
			return { text: line, prefix: '', lazy: true };
		},
		write,
		// `reads` takes the written marker whole, so the written spelling always reads back.
		spells: (line, text, place) => line === write(text, place),
		blankKeepsMarker: true,
		continuesLazily: (above, line, _aboveFirst, grammar) =>
			keepsParagraphOpen(shape, above, grammar) &&
			keepsParagraphOpen(shape, line, grammar) &&
			!opensOuterBlock(line, grammar)
	};
	markedCodecs.set(shape, codec);
	return codec;
}

/** A blank separator stays bare, and a blank line ending the body is indented, or a reload would
 *  read it outside the container. */
function indentedCodec<D extends object>(shape: IndentedLines<D>, data: D): LineCodec {
	const opener = shape.first(data);
	const pad = shape.rest(data);
	const column = pad.length;
	const head = shape.paragraphHead?.(data) ?? '';
	return {
		read(line, place) {
			if (place.first) {
				const match = shape.open.exec(line);
				// The marker reads back only while it is the one this data writes.
				if (!match || shape.first(shape.data(match)) !== opener) return null;
				return { text: line.slice(match[0].length), prefix: match[0], lazy: false };
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
			if (!shape.lazy) return null;
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
		continuesLazily: (above, line, aboveFirst, grammar) =>
			keepsParagraphOpen(shape, aboveFirst ? head + above : above, grammar) &&
			keepsParagraphOpen(shape, line, grammar) &&
			!opensOuterBlock(line, grammar)
	};
}

/** Whether a tab sits in `text`'s leading whitespace, which a read at a column off the tab stops
 *  rewrites as spaces. */
function leadingTab(text: string): boolean {
	for (let i = 0; text[i] === ' ' || text[i] === '\t'; i++) if (text[i] === '\t') return true;
	return false;
}
