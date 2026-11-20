/**
 * The markers a container writes: what a new line inside it starts with, and what a copy that
 * enters it opens with; and whether a line holds markers alone, read through the line shapes.
 */

import { isBlankText } from '../core/lines';
import type { LaidBlock, LaidLine } from './layout';
import { lineRest } from './lines';
import {
	containersHolding,
	factsOf,
	firstBodyLine,
	firstLine,
	leafAt,
	lineOf,
	titleRowOf,
	type Doc
} from './document';

const MARKED = ['every-line', 'first-line'];
// A list marker and its task box, which a line after the first indents past.
const GLYPH = /(^|[\s>])([-*+]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?(?=[ \t]|$)/g;

const markerOn = (doc: Doc, line: { from: number; markerTo: number }) =>
	doc.source.slice(line.from, line.markerTo);

/** What a new line continuing the text at `byte` starts with, through the containers `keep`
 *  allows, outermost first. */
export function continuation(doc: Doc, byte: number, keep: (c: LaidBlock) => boolean = () => true) {
	let prefix = '';
	for (const container of containersHolding(doc, byte)) {
		if (!keep(container)) break;
		const facts = factsOf(doc, container);
		if (!MARKED.includes(facts.lines)) continue;
		const line = lineOf(container, byte);
		// A file's open last line, a marker over an empty block, is a body line all the same.
		const openEnd = line.own && byte === doc.source.length && leafAt(doc, byte) !== null;
		if (line.own && !openEnd) continue;
		const body = facts.lines === 'first-line' ? firstBodyLine(container) : undefined;
		const first = body ?? (openEnd && facts.lines === 'first-line' ? line : undefined);
		const own = line.markerTo > line.from ? line : undefined;
		// A first-line marker is its width in spaces on every later line (§ 5.5): a line spelling
		// less of it (a lazy or short one) is no measure of it, one spelling it whole (a tab) is.
		const short =
			!!first && !!own && own !== first && columns(doc, own, own.markerTo) < indentOf(doc, first);
		const marked = short ? first : (own ?? lazyMarked(doc, container, line, facts.lines));
		const marker = marked ? spelledForText(doc, marked, facts.lines) : '';
		if (facts.lines === 'first-line' && marked === first) {
			prefix +=
				facts.indent !== undefined
					? ' '.repeat(facts.indent)
					: marker.replace(
							GLYPH,
							(_, lead: string, glyph: string) => lead + ' '.repeat(glyph.length)
						);
		} else prefix += marker;
	}
	return prefix;
}

/** How far an item's first line `first` indents its later lines: its glyph and the spaces after
 *  it, a task box aside. */
function indentOf(doc: Doc, first: LaidLine): number {
	const glyph = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]*/.exec(markerOn(doc, first))?.[0] ?? '';
	return columns(doc, first, first.from + glyph.length);
}

/** How many columns `line` spans from its marker's start to `to`, a tab to the next stop of four
 *  from the line's start. */
function columns(doc: Doc, line: LaidLine, to: number): number {
	const start = doc.source.lastIndexOf('\n', line.from - 1) + 1;
	let [col, before] = [0, 0];
	for (let i = start; i < to; i++) {
		if (i === line.from) before = col;
		col = doc.source[i] === '\t' ? col + 4 - (col % 4) : col + 1;
	}
	return col - before;
}

/** The marker `line` writes, as a line with text spells it: a blank quoted line's bare `>` takes the
 *  space a typed letter there writes after it. */
function spelledForText(doc: Doc, line: LaidLine, shape: string): string {
	const marker = markerOn(doc, line);
	const bare = shape === 'every-line' && !/[ \t]$/.test(marker);
	return bare && isBlankText(lineRest(doc.source, line.markerTo)) ? marker + ' ' : marker;
}

/** A line its container reads without a marker still holds the caret inside it, so a line after
 *  it takes the marker of the container's nearest marked line. */
function lazyMarked(
	doc: Doc,
	container: LaidBlock,
	line: LaidLine,
	shape: string
): LaidLine | undefined {
	// Under a first-line marker, an indent with no marker is one a block inside holds as its own.
	if (shape === 'first-line' && /[ \t]/.test(doc.source[line.from] ?? '')) return undefined;
	const marked = (l: LaidLine) => !l.own && l.markerTo > l.from;
	// Up a line at a time from the line ending above, which a nested container's markers can't hide.
	for (let above = line; ;) {
		const end = doc.source.lastIndexOf('\n', above.from - 1);
		if (end < container.from) break;
		above = container.lineAt!(end);
		if (marked(above)) return above;
	}
	return firstLine(container, marked);
}

/** The lines a container opens with before its body: an alert's title line, a `:::` line, a
 *  section's opener and summary. */
function openingLines(doc: Doc, container: LaidBlock): string {
	const row = titleRowOf(doc, container);
	if (row) {
		const line = container.lineAt!(row.from);
		const holds = line.from <= row.from && row.from < line.to;
		return doc.source.slice(container.from, holds ? line.to : row.to);
	}
	let opening = '';
	for (const line of container.linesIn!(container.from)) {
		if (!line.own) break;
		opening += doc.source.slice(line.from, line.to);
	}
	return opening;
}

/** What a copy starting inside `container` at `from` opens with. */
export function openingOf(doc: Doc, container: LaidBlock, from: number): string {
	const { lines } = factsOf(doc, container);
	if (lines === 'fenced') return openingLines(doc, container);
	if (lines === 'every-line') {
		const line = lineOf(container, from);
		return openingLines(doc, container) + (line.own ? '' : markerOn(doc, line));
	}
	if (lines === 'first-line') {
		const first = firstBodyLine(container);
		return first ? markerOn(doc, first) : '';
	}
	return '';
}

/** Whether the line starting at `at` of `text` holds container markers alone, its ending aside. */
export const markersOnly = (doc: Doc, text: string, at: number): boolean =>
	/^\r?(\n|$)/.test(text.slice(doc.host.pastMarkers(text, at)));
