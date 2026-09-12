/**
 * A typed inline delimiter closes itself: a lone `$`, backtick, `*`, `_` or `~~` would pair with
 * whatever matching run comes later on the line, so the keystroke lands its twin after the caret.
 * Typing the closer over the twin steps past it, a closer typed by hand seats the next byte
 * outside, and the empty pair drops its twin when the first body byte makes it no construct.
 * `applyDelimiterAutoPair` is the one `beforeinput` arm every prose surface runs (G4.65).
 */

import {
	constructContentRange,
	inlineDescendants,
	parseInline,
	type ContentRange
} from '../../../core/inline';
import { isAutoPairTrigger } from '../../../core/inline/scan/plugin-syntax';

export type AutoPairEdit =
	| { kind: 'write'; text: string; caret: number }
	/** The typed byte completed a construct's closer; what follows belongs outside it. */
	| { kind: 'close'; text: string; caret: number }
	/** Nothing written: the caret passes the twin. Over a construct's closer that run may be
	 *  unpainted, and then only the SIDE moves, which the surface records as an edge affinity. */
	| { kind: 'step-over'; caret: number; overConstruct: boolean };

interface PairPolicy {
	/** A lone press pairs (`*|*`); false for a delimiter whose construct needs a double run. */
	single: boolean;
	/** What a press inside the empty pair does: step past the twin, or grow both runs. */
	inside: 'step-over' | 'grow';
	/** No pair straight after a word byte: `2*3` and `snake_case` are not emphasis openers. */
	notAfterWord?: boolean;
}

const STEP: PairPolicy = { single: true, inside: 'step-over' };
const BUILTIN: Record<string, PairPolicy> = {
	'`': STEP,
	'*': { single: true, inside: 'grow', notAfterWord: true },
	_: { single: true, inside: 'grow', notAfterWord: true },
	// `~5 minutes` would strike the 5 (GFM takes a single tilde), so only `~~` pairs.
	'~': { single: false, inside: 'grow' }
};

const isWordByte = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

function policyOf(ch: string): PairPolicy | null {
	return BUILTIN[ch] ?? (isAutoPairTrigger(ch) ? STEP : null);
}

// ── The resolver ─────────────────────────────────────────────────────────────

/**
 * What a single typed byte does at a collapsed caret, or null to leave the engine its insert.
 * `content` bounds the inline scan (a heading's `# ` is not prose); the caret must lie inside it.
 * `keepsBlockKind` says whether a written line still reloads as this block: a grown `****` is a
 * thematic break and `~~~~` a fence, so such a pair steps past a twin instead, or declines.
 */
export function resolveDelimiterAutoPair(
	text: string,
	content: ContentRange,
	caret: number,
	typed: string,
	keepsBlockKind: (text: string) => boolean = () => true
): AutoPairEdit | null {
	if (typed.length !== 1 || caret < content.start || caret > content.end) return null;
	const before = text[caret - 1];
	const after = text[caret];
	const policy = policyOf(typed);
	if (!policy) return collapseEmptyPair(text, content, caret, typed);
	if (after === typed && closingRunAt(text, content, caret, typed)) {
		return { kind: 'step-over', caret: caret + 1, overConstruct: true };
	}
	const paired = text.slice(0, caret) + typed + text.slice(caret);
	if (closerEndsAt(paired, content, caret + 1, typed)) {
		return { kind: 'close', text: paired, caret: caret + 1 };
	}
	const pair = (next: string): AutoPairEdit | null => {
		if (keepsBlockKind(next)) return write(next, caret + 1);
		return after === typed ? { kind: 'step-over', caret: caret + 1, overConstruct: false } : null;
	};
	if (after === typed) {
		if (before === typed) {
			if (policy.inside === 'step-over') {
				return { kind: 'step-over', caret: caret + 1, overConstruct: false };
			}
			return pair(text.slice(0, caret) + typed + typed + text.slice(caret));
		}
		// A byte in front of another run's opener is spelling something out, not opening a span.
		return null;
	}
	if (before === typed && !closerEndsAt(text, content, caret, typed)) {
		// `~|` plus `~`: the double run this delimiter pairs on, as long as it IS a lone run.
		const single = text[caret - 2] !== typed;
		if (policy.inside === 'grow' && single) {
			return pair(text.slice(0, caret) + typed.repeat(3) + text.slice(caret));
		}
		return null;
	}
	if (!policy.single || (policy.notAfterWord && isWordByte(before))) return null;
	return pair(text.slice(0, caret) + typed + typed + text.slice(caret));
}

/**
 * Inside a revealed source (`$ab|$`) the twin is the live closer, and typing it means "done":
 * the caret steps past it and the caller folds the reveal, so the formula renders at once.
 */
export function stepsOverRevealedCloser(text: string, caret: number, typed: string): boolean {
	return typed.length === 1 && policyOf(typed) !== null && text[caret] === typed;
}

/** Backspace at an empty pair takes both runs, between them (`**|**`) or right after them
 *  (`$$|`), as it does in any IDE. Exactly a pair of equal runs, one or two bytes each: a longer
 *  run is a fence or a literal the user built by hand. */
export function resolveEmptyPairBackspace(text: string, caret: number): AutoPairEdit | null {
	const pair = emptyPairEnding(text, caret) ?? emptyPairAround(text, caret);
	if (!pair) return null;
	return write(text.slice(0, pair.start) + text.slice(pair.end), pair.start);
}

const write = (text: string, caret: number): AutoPairEdit => ({ kind: 'write', text, caret });

// ── The surface arm ──────────────────────────────────────────────────────────

/** What a prose surface lends the arm. Reactive reads are thunks, so nothing here goes stale. */
export interface AutoPairSurface {
	/** The bytes the caret indexes: the display text, or the revealed DOM text during a reveal. */
	text(): string;
	content(): ContentRange;
	caret(): number | null;
	hasSelection(): boolean;
	isRevealing(): boolean;
	foldReveal(): { settled: Promise<void> } | null;
	/** Whether the closer a step-over passes is on screen; unpainted, only the side moves. */
	markersPaint(): boolean;
	setCaret(offset: number): void;
	/** The arrival the seat reads next: past the construct's delimiters. */
	seatOutside(): void;
	/** One CST write plus the caret it parks. */
	write(text: string, caretBefore: number, caretAfter: number): void;
	/** A step-over that leaves the line one an on-type completer claims (`$$`), which only a
	 *  content write consults. */
	completesLine?(caret: number): boolean;
	/** The resolver's block-kind guard, for a surface whose line can become another block. */
	keepsBlockKind?(text: string): boolean;
}

/**
 * The `beforeinput` arm. True when the press was this seam's: the event is cancelled and the
 * surface has written, moved or re-seated the caret.
 */
export function applyDelimiterAutoPair(e: InputEvent, surface: AutoPairSurface): boolean {
	const typing = e.inputType === 'insertText';
	if (!typing && e.inputType !== 'deleteContentBackward') return false;
	if (e.isComposing || surface.hasSelection()) return false;
	const caret = surface.caret();
	if (caret === null) return false;
	const text = surface.text();
	if (surface.isRevealing()) {
		if (!typing || !stepsOverRevealedCloser(text, caret, e.data ?? '')) return false;
		e.preventDefault();
		surface.setCaret(caret + 1);
		void surface.foldReveal()?.settled;
		return true;
	}
	const edit = typing
		? resolveDelimiterAutoPair(text, surface.content(), caret, e.data ?? '', surface.keepsBlockKind)
		: resolveEmptyPairBackspace(text, caret);
	if (!edit) return false;
	e.preventDefault();
	switch (edit.kind) {
		case 'step-over':
			if (edit.overConstruct && !surface.markersPaint()) surface.seatOutside();
			else if (surface.completesLine?.(edit.caret)) surface.write(text, caret, edit.caret);
			else surface.setCaret(edit.caret);
			return true;
		case 'close':
			surface.write(edit.text, caret, edit.caret);
			surface.seatOutside();
			return true;
		case 'write':
			surface.write(edit.text, caret, edit.caret);
			return true;
	}
}

// ── Runs ─────────────────────────────────────────────────────────────────────

/** Length of the run of `ch` ending just before `at` (0 when `text[at - 1]` is not `ch`). */
function runBefore(text: string, at: number, ch: string): number {
	let n = 0;
	while (text[at - 1 - n] === ch) n++;
	return n;
}

function runAfter(text: string, at: number, ch: string): number {
	let n = 0;
	while (text[at + n] === ch) n++;
	return n;
}

// `X..X|X..X`: equal runs of a pair delimiter, one or two bytes, with nothing of it either side.
function emptyPairAround(text: string, caret: number): ContentRange | null {
	const d = text[caret - 1];
	if (d === undefined || !policyOf(d)) return null;
	const k = runBefore(text, caret, d);
	if (k > 2 || runAfter(text, caret, d) !== k) return null;
	return { start: caret - k, end: caret + k };
}

// `XX|`: a stepped-over empty pair with the caret after it. Only the delimiters that step (the
// emphasis family grows instead, and its `**|` is a double opener with content ahead).
function emptyPairEnding(text: string, caret: number): ContentRange | null {
	const d = text[caret - 1];
	if (d === undefined || policyOf(d)?.inside !== 'step-over' || text[caret] === d) return null;
	if (runBefore(text, caret, d) !== 2) return null;
	return { start: caret - 2, end: caret };
}

// ── Constructs ───────────────────────────────────────────────────────────────

// `X|X` plus the typed byte: keep the twin run only if the pair then parses as a construct.
function collapseEmptyPair(
	text: string,
	content: ContentRange,
	caret: number,
	typed: string
): AutoPairEdit | null {
	const d = text[caret - 1];
	if (d === undefined || !policyOf(d)) return null;
	const k = runBefore(text, caret, d);
	if (k > 2 || runAfter(text, caret, d) !== k) return null;
	const paired = text.slice(0, caret) + typed + text.slice(caret);
	const shifted = { start: content.start, end: content.end + 1 };
	if (constructAt(paired, shifted, caret - k, caret + 1 + k)) return null;
	return write(text.slice(0, caret) + typed + text.slice(caret + k), caret + 1);
}

// The caret sits inside or at the start of the closing run of a construct this delimiter both
// opens and closes, so the byte under it is that construct's own closer.
function closingRunAt(text: string, content: ContentRange, caret: number, typed: string): boolean {
	for (const node of inlineDescendants(parseInline(text, content.start, content.end))) {
		if (node.kind === 'text' || text[node.start] !== typed || node.end <= caret) continue;
		let closer = node.end;
		while (closer > caret && text[closer - 1] === typed) closer--;
		if (closer <= caret) return true;
	}
	return false;
}

// A construct of `typed`'s family ends exactly at `end`, its last byte in the closing run. The
// scan's bound grows past the content by the byte a caller has just inserted.
function closerEndsAt(text: string, content: ContentRange, end: number, typed: string): boolean {
	const bound = Math.max(content.end, end);
	for (const node of inlineDescendants(parseInline(text, content.start, bound))) {
		if (node.kind === 'text' || node.end !== end || text[end - 1] !== typed) continue;
		const inner = constructContentRange(node);
		if (!inner || inner.end < end) return true;
	}
	return false;
}

function constructAt(text: string, content: ContentRange, start: number, end: number): boolean {
	for (const node of inlineDescendants(parseInline(text, content.start, content.end))) {
		if (node.kind !== 'text' && node.start === start && node.end === end) return true;
	}
	return false;
}
