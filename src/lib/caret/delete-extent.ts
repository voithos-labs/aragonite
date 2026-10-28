/**
 * What a collapsed delete takes, decided by the editor so every engine takes the same bytes: a
 * character (an emoji and a CRLF pair whole, Backspace only an accent), a word by the Unicode word
 * rule, or to a line's edge. Each read of a segmenter takes a fixed window around the caret, wider
 * only for a cluster or word longer than it.
 */

import { graphemeSegmenter, wordSegmenter } from '../core/text-units';
import { recordDeleteWindow } from '../perf/instruments';
import { usesMacEditingConventions } from '../schema/platform-conventions';
import type { VisibleText } from '../browser/offsets';
import type { DeleteDirection, DeleteIntent } from '../browser/input';

export interface DeleteSpan {
	start: number;
	end: number;
}

/** Why a delete the editor decides went to the browser after all, read back on `input` instead.
 *  The editor's own check (G1.132) accepts an undecided delete only with one of these. */
export type DeleteDecline =
	'claimed' | 'composing' | 'not-cancelable' | 'range' | 'no-caret' | 'wide-keyless' | 'surface';

export type DeleteVerdict = { decided: true } | { decided: false; decline: DeleteDecline };

/** What a block did with a collapsed delete: took it, found nothing in the line to take at the
 *  edge the delete faces (where the block's merge is the answer), or left it to the browser. */
export type DeleteAnswer = 'taken' | 'at-edge' | 'declined';

/** Wide enough for the longest emoji sequences (a tag flag is 14 code units); a cluster the window
 *  may have cut is read again in one twice the size. */
export const DELETE_WINDOW = 64;

/** The character a delete at `caret` takes in `text`, kept inside `bounds`; null at the bound the
 *  delete faces, where there is nothing in the line to take. */
export function characterExtent(
	text: string,
	caret: number,
	direction: DeleteDirection,
	bounds: DeleteSpan
): DeleteSpan | null {
	if (direction === 'backward') {
		if (caret <= bounds.start) return null;
		return {
			start: caret - backwardUnit(clusterBefore(text, caret, bounds.start)).length,
			end: caret
		};
	}
	if (caret >= bounds.end) return null;
	return { start: caret, end: caret + clusterAfter(text, caret, bounds.end).length };
}

/** What a block hands the delete rule. */
export interface DeleteContext {
	/** The raw text the caret counts into. */
	text: string;
	caret: number;
	bounds: DeleteSpan;
	/** The raw offset at the `side` edge of the caret's visual line; null where nothing is laid out. */
	lineEdge?: (side: 'start' | 'end') => number | null;
	/** The text as the screen shows it (hidden markers left out, a widget one character), for words. */
	visible?: VisibleText;
}

/** The raw span a delete of `intent` takes at the caret; null where there's nothing to take. A word
 *  or line that would take nothing (the caret at a line's start, say) takes one character. */
export function deleteExtent(intent: DeleteIntent, context: DeleteContext): DeleteSpan | null {
	const { text, caret, bounds } = context;
	const { unit, direction } = intent;
	const span =
		unit === 'word'
			? wordSpan(context, direction)
			: unit === 'hard-line' || unit === 'soft-line'
				? lineSpan(context, unit, direction)
				: null;
	if (span && span.end > span.start) return span;
	return characterExtent(text, caret, direction, bounds);
}

// ── Words ────────────────────────────────────────────────────────────────────

/** Where a forward word delete stops: at the next word's start, or, on Apple platforms, at the end
 *  of the word it takes, leaving the space after it. */
export type ForwardWordReach = 'next-word' | 'word-end';

function forwardWordReach(): ForwardWordReach {
	return usesMacEditingConventions() ? 'word-end' : 'next-word';
}

/** The word a delete at `caret` takes in `text`, by the Unicode word rule: Backspace takes the
 *  spaces before the caret and the word before them; null at a line break or the bound faced. */
export function wordExtent(
	text: string,
	caret: number,
	direction: DeleteDirection,
	bounds: DeleteSpan,
	reach: ForwardWordReach
): DeleteSpan | null {
	if (!wordSegmenter()) return null;
	if (direction === 'backward') {
		if (caret <= bounds.start || isLineBreak(text[caret - 1])) return null;
		return { start: wordStartBefore(text, caret, bounds.start), end: caret };
	}
	if (caret >= bounds.end || isLineBreak(text[caret])) return null;
	return { start: caret, end: wordEndAfter(text, caret, bounds.end, reach) };
}

function wordSpan(context: DeleteContext, direction: DeleteDirection): DeleteSpan | null {
	const { text, caret, bounds, visible } = context;
	if (!visible) return wordExtent(text, caret, direction, bounds, forwardWordReach());
	const at = visibleIndexAt(visible, caret);
	const within = {
		start: visibleIndexAt(visible, bounds.start),
		end: charsEndingBy(visible, bounds.end)
	};
	const span = wordExtent(visible.text, at, direction, within, forwardWordReach());
	if (!span) return null;
	return direction === 'backward'
		? { start: visible.rawStart[span.start], end: caret }
		: { start: caret, end: visible.rawEnd[span.end - 1] };
}

/** The first visible character at or after raw `raw`. */
function visibleIndexAt(visible: VisibleText, raw: number): number {
	const i = visible.rawStart.findIndex((start) => start >= raw);
	return i === -1 ? visible.text.length : i;
}

/** How many visible characters end at or before raw `raw`. */
function charsEndingBy(visible: VisibleText, raw: number): number {
	const i = visible.rawEnd.findIndex((end) => end > raw);
	return i === -1 ? visible.text.length : i;
}

function wordStartBefore(text: string, caret: number, floor: number): number {
	for (let size = DELETE_WINDOW; ; size *= 2) {
		const from = Math.max(floor, caret - size);
		const window = text.slice(from, caret);
		recordDeleteWindow(window.length);
		const start = from + runStartBefore(window);
		// A run reaching the window's first unit may go on past the cut, half a pair included.
		if (from === floor || start - from > 1) return start;
	}
}

function wordEndAfter(
	text: string,
	caret: number,
	ceiling: number,
	reach: ForwardWordReach
): number {
	for (let size = DELETE_WINDOW; ; size *= 2) {
		const to = Math.min(ceiling, caret + size);
		const window = text.slice(caret, to);
		recordDeleteWindow(window.length);
		const end = caret + runEndAfter(window, reach);
		if (to === ceiling || to - end > 1) return end;
	}
}

/** Where the spaces before the end of `window`, then the word or punctuation run before them,
 *  start. */
function runStartBefore(window: string): number {
	let at = window.length;
	while (at > 0 && isSpace(window[at - 1])) at--;
	if (at === 0 || isLineBreak(window[at - 1])) return at;
	const segments = segmentsOf(window);
	let segment = segments.containing(at - 1)!;
	if (segment.isWordLike) return segment.index;
	while (segment.index > 0) {
		const before = segments.containing(segment.index - 1)!;
		if (before.isWordLike || !continuesRun(before.segment)) break;
		segment = before;
	}
	return segment.index;
}

/** Where the word or punctuation run at the start of `window` ends, with the spaces after it to
 *  the next word or, on Apple platforms, the spaces before it instead. */
function runEndAfter(window: string, reach: ForwardWordReach): number {
	let at = 0;
	const skipSpaces = () => {
		while (at < window.length && isSpace(window[at])) at++;
	};
	if (isSpace(window[0])) {
		skipSpaces();
		if (reach === 'next-word') return at;
	}
	if (at === window.length || isLineBreak(window[at])) return at;
	const segments = segmentsOf(window);
	let segment = segments.containing(at)!;
	at = segment.index + segment.segment.length;
	while (!segment.isWordLike && at < window.length) {
		const next = segments.containing(at)!;
		if (next.isWordLike || !continuesRun(next.segment)) break;
		segment = next;
		at = next.index + next.segment.length;
	}
	if (reach === 'next-word') skipSpaces();
	return at;
}

// `wordExtent` returns before any read where the platform has no segmenter.
const segmentsOf = (window: string): Intl.Segments => wordSegmenter()!.segment(window);

const isSpace = (char: string | undefined) => char !== undefined && /[^\S\r\n]/.test(char);
const isLineBreak = (char: string | undefined) => char === '\n' || char === '\r';
// A run of non-word segments takes in any that holds no space: commas, an emoji, a widget.
const continuesRun = (segment: string) => !/\s/.test(segment);

// ── Lines ────────────────────────────────────────────────────────────────────

function lineSpan(
	context: DeleteContext,
	unit: 'hard-line' | 'soft-line',
	direction: DeleteDirection
): DeleteSpan | null {
	const { text, caret, bounds } = context;
	const side = direction === 'backward' ? 'start' : 'end';
	const edge =
		(unit === 'soft-line' ? context.lineEdge?.(side) : null) ?? hardLineEdge(text, caret, side);
	return direction === 'backward'
		? { start: Math.max(bounds.start, Math.min(edge, caret)), end: caret }
		: { start: caret, end: Math.min(bounds.end, Math.max(edge, caret)) };
}

/** Where the line the caret sits on starts or ends: just after the ending before it, or at the
 *  ending after it, a CRLF pair's `\r` included. */
function hardLineEdge(text: string, caret: number, side: 'start' | 'end'): number {
	if (side === 'start') return text.lastIndexOf('\n', caret - 1) + 1;
	const lf = text.indexOf('\n', caret);
	if (lf === -1) return text.length;
	return lf > caret && text[lf - 1] === '\r' ? lf - 1 : lf;
}

// ── Clusters ─────────────────────────────────────────────────────────────────

// A keycap is a digit, VS16 and U+20E3; a skin tone is a modifier; a flag is two regional indicators.
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|⃣|️/u;

function backwardUnit(cluster: string): string {
	if (cluster === '\r\n' || EMOJI.test(cluster)) return cluster;
	return Array.from(cluster).at(-1) ?? cluster;
}

const REGIONAL_INDICATOR_START = /^[\uDC00-\uDFFF]?\p{Regional_Indicator}/u;

// A cluster within two segments of an edge the window cut may run past it: the cut can leave half
// a surrogate pair, or the ZWJ before an emoji, as a segment of its own.
function clusterBefore(text: string, caret: number, floor: number): string {
	for (let size = DELETE_WINDOW; ; size *= 2) {
		const from = Math.max(floor, caret - size);
		const window = text.slice(from, caret);
		recordDeleteWindow(window.length);
		const segments = graphemeSegmenter()?.segment(window);
		if (!segments) return Array.from(window).at(-1) ?? window;
		const last = segments.containing(window.length - 1)!;
		const clearOfCut = last.index > 0 && segments.containing(last.index - 1)!.index > 0;
		// Flags pair regional indicators from the start of their run, so a cut run pairs them wrong.
		if (from === floor || (clearOfCut && !REGIONAL_INDICATOR_START.test(window))) {
			return last.segment;
		}
	}
}

function clusterAfter(text: string, caret: number, ceiling: number): string {
	for (let size = DELETE_WINDOW; ; size *= 2) {
		const to = Math.min(ceiling, caret + size);
		const window = text.slice(caret, to);
		recordDeleteWindow(window.length);
		const segments = graphemeSegmenter()?.segment(window);
		if (!segments) return Array.from(window)[0] ?? window;
		const first = segments.containing(0)!.segment;
		const next = segments.containing(first.length)?.segment ?? '';
		if (to === ceiling || first.length + next.length < window.length) return first;
	}
}
