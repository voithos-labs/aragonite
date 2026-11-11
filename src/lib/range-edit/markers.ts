/**
 * The markers a container writes: what a new line inside it starts with, and what a copy that
 * enters it opens with.
 */

import type { LaidBlock, LaidLine } from './layout';
import {
	containersHolding,
	factsOf,
	firstBodyLine,
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
		if (line.own) continue;
		const marked = line.markerTo > line.from ? line : lazyMarked(doc, container, line, facts.lines);
		const marker = marked ? markerOn(doc, marked) : '';
		if (facts.lines === 'first-line' && marked === firstBodyLine(container)) {
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
	const marked = container.lines!.filter((l) => !l.own && l.markerTo > l.from);
	return marked.filter((l) => l.from < line.from).at(-1) ?? marked[0];
}

/** The lines a container opens with before its body: an alert's title line, a `:::` line, a
 *  section's opener and summary. */
function openingLines(doc: Doc, container: LaidBlock): string {
	const row = titleRowOf(doc, container);
	if (row) {
		const line = container.lines!.find((l) => l.from <= row.from && row.from < l.to);
		return doc.source.slice(container.from, line ? line.to : row.to);
	}
	const first = container.lines!.findIndex((l) => !l.own);
	const lines = first < 0 ? container.lines! : container.lines!.slice(0, first);
	return lines.map((l) => doc.source.slice(l.from, l.to)).join('');
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
