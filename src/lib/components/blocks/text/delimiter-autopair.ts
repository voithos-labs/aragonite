/**
 * A typed inline delimiter closes itself: a lone `$`, backtick, `*`, `_` or `~~` would pair with
 * whatever matching run comes later on the line, so the keystroke writes its partner after the
 * caret. Typing that partner steps past it, a closer typed by hand puts the next byte outside,
 * and an empty pair drops its partner when the first body byte makes it no construct.
 * `applyDelimiterAutoPair` is the one `beforeinput` handler every prose block runs (G4.65).
 */

import {
	constructContentRange,
	inlineDescendants,
	parseInline,
	type ContentRange
} from '../../../core/inline';
import { isAutoPairTrigger } from '../../../core/inline/scan/plugin-syntax';
import { defaultGrammarView, type GrammarView } from '../../../schema/block-openers';

export type AutoPairEdit =
	| { kind: 'write'; text: string; caret: number }
	/** The typed byte completed a construct's closer; what follows belongs outside it. */
	| { kind: 'close'; text: string; caret: number }
	/** Nothing written: the caret passes its partner. Over a construct's closer that run may be
	 *  hidden, and then only the side changes, which the block records as an arrival side. */
	| { kind: 'step-over'; caret: number; overConstruct: boolean };

interface PairPolicy {
	/** One keypress pairs (`*|*`); false for a delimiter whose construct needs a double run. */
	single: boolean;
	/** What a keypress inside the empty pair does: step past the partner, or grow both runs. */
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

// A plugin's delimiter pairs only in an editor that lists the plugin.
function policyOf(ch: string, grammar: GrammarView): PairPolicy | null {
	return BUILTIN[ch] ?? (isAutoPairTrigger(ch, grammar) ? STEP : null);
}

// ── The resolver ─────────────────────────────────────────────────────────────

/**
 * What a single typed byte does at a collapsed caret, or null to leave the insertion to the
 * browser. `content` bounds the inline scan (a heading's `# ` is not prose); the caret must lie
 * inside it. `keepsBlockKind` says whether the written line still parses as this block: a grown
 * `****` is a thematic break and `~~~~` a fence, so such a pair steps past its partner instead.
 */
export function resolveDelimiterAutoPair(
	text: string,
	content: ContentRange,
	caret: number,
	typed: string,
	keepsBlockKind: (text: string) => boolean = () => true,
	grammar: GrammarView = defaultGrammarView
): AutoPairEdit | null {
	if (typed.length !== 1 || caret < content.start || caret > content.end) return null;
	const before = text[caret - 1];
	const after = text[caret];
	const policy = policyOf(typed, grammar);
	if (!policy) return collapseEmptyPair(text, content, caret, typed, grammar);
	if (after === typed && closingRunAt(text, content, caret, typed, grammar)) {
		return { kind: 'step-over', caret: caret + 1, overConstruct: true };
	}
	const paired = text.slice(0, caret) + typed + text.slice(caret);
	if (closerEndsAt(paired, content, caret + 1, typed, grammar)) {
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
	if (before === typed && !closerEndsAt(text, content, caret, typed, grammar)) {
		// `~|` plus `~`: the double run this delimiter pairs on, as long as it is a lone run.
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
 * Inside a construct whose source is showing (`$ab|$`) the partner is the real closer, and typing
 * it means "done": the caret steps past it and the caller hides the source, so it renders at once.
 */
export function stepsOverRevealedCloser(
	text: string,
	caret: number,
	typed: string,
	grammar: GrammarView = defaultGrammarView
): boolean {
	return typed.length === 1 && policyOf(typed, grammar) !== null && text[caret] === typed;
}

/** Backspace at an empty pair takes both runs, between them (`**|**`) or right after them
 *  (`$$|`), as it does in any IDE. Exactly a pair of equal runs, one or two bytes each: a longer
 *  run is a fence or a literal the user built by hand. */
export function resolveEmptyPairBackspace(
	text: string,
	caret: number,
	grammar: GrammarView = defaultGrammarView
): AutoPairEdit | null {
	const pair = emptyPairEnding(text, caret, grammar) ?? emptyPairAround(text, caret, grammar);
	if (!pair) return null;
	return write(text.slice(0, pair.start) + text.slice(pair.end), pair.start);
}

const write = (text: string, caret: number): AutoPairEdit => ({ kind: 'write', text, caret });

// ── The beforeinput handler ──────────────────────────────────────────────────

/** What a prose block gives the handler. Reactive values arrive as functions, so none go stale. */
export interface AutoPairSurface {
	/** The bytes the caret counts into: the displayed text, or the DOM text while a construct's
	 *  source is showing. */
	text(): string;
	content(): ContentRange;
	caret(): number | null;
	hasSelection(): boolean;
	isRevealing(): boolean;
	foldReveal(): { settled: Promise<void> } | null;
	/** Whether the closer a step-over passes is on screen; when it is hidden, only the side moves. */
	markersPaint(): boolean;
	setCaret(offset: number): void;
	/** Record the arrival side the next typed byte reads: past the construct's delimiters. */
	seatOutside(): void;
	/** One CST write plus the caret it leaves behind. */
	write(text: string, caretBefore: number, caretAfter: number): void;
	/** Whether a step-over leaves the line one an on-type completer takes (`$$`); only a content
	 *  write asks. */
	completesLine?(caret: number): boolean;
	/** The resolver's block-kind check, for a block whose line can become a different block. */
	keepsBlockKind?(text: string): boolean;
	/** The editor's grammar, so a plugin's delimiter pairs only where the plugin is listed. */
	grammar: GrammarView | undefined;
}

/**
 * The `beforeinput` handler. True when the key belonged here: the event is cancelled and the
 * block has written bytes, moved the caret, or changed its arrival side.
 */
export function applyDelimiterAutoPair(e: InputEvent, surface: AutoPairSurface): boolean {
	const typing = e.inputType === 'insertText';
	if (!typing && e.inputType !== 'deleteContentBackward') return false;
	if (e.isComposing || surface.hasSelection()) return false;
	const caret = surface.caret();
	if (caret === null) return false;
	const text = surface.text();
	if (surface.isRevealing()) {
		if (!typing || !stepsOverRevealedCloser(text, caret, e.data ?? '', surface.grammar)) {
			return false;
		}
		e.preventDefault();
		surface.setCaret(caret + 1);
		void surface.foldReveal()?.settled;
		return true;
	}
	const edit = typing
		? resolveDelimiterAutoPair(
				text,
				surface.content(),
				caret,
				e.data ?? '',
				surface.keepsBlockKind,
				surface.grammar
			)
		: resolveEmptyPairBackspace(text, caret, surface.grammar);
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
function emptyPairAround(text: string, caret: number, grammar: GrammarView): ContentRange | null {
	const d = text[caret - 1];
	if (d === undefined || !policyOf(d, grammar)) return null;
	const k = runBefore(text, caret, d);
	if (k > 2 || runAfter(text, caret, d) !== k) return null;
	return { start: caret - k, end: caret + k };
}

// `XX|`: a stepped-over empty pair with the caret after it. Only the delimiters that step (the
// emphasis family grows instead, and its `**|` is a double opener with content ahead).
function emptyPairEnding(text: string, caret: number, grammar: GrammarView): ContentRange | null {
	const d = text[caret - 1];
	if (d === undefined || policyOf(d, grammar)?.inside !== 'step-over' || text[caret] === d) {
		return null;
	}
	if (runBefore(text, caret, d) !== 2) return null;
	return { start: caret - 2, end: caret };
}

// ── Constructs ───────────────────────────────────────────────────────────────

// `X|X` plus the typed byte: keep the partner run only if the pair then parses as a construct.
function collapseEmptyPair(
	text: string,
	content: ContentRange,
	caret: number,
	typed: string,
	grammar: GrammarView
): AutoPairEdit | null {
	const d = text[caret - 1];
	if (d === undefined || !policyOf(d, grammar)) return null;
	const k = runBefore(text, caret, d);
	if (k > 2 || runAfter(text, caret, d) !== k) return null;
	const paired = text.slice(0, caret) + typed + text.slice(caret);
	const shifted = { start: content.start, end: content.end + 1 };
	if (constructAt(paired, shifted, caret - k, caret + 1 + k, grammar)) return null;
	return write(text.slice(0, caret) + typed + text.slice(caret + k), caret + 1);
}

// The caret sits inside or at the start of the closing run of a construct this delimiter both
// opens and closes, so the byte under it is that construct's own closer.
function closingRunAt(
	text: string,
	content: ContentRange,
	caret: number,
	typed: string,
	grammar: GrammarView
): boolean {
	for (const node of inlineDescendants(
		parseInline(text, content.start, content.end, undefined, grammar)
	)) {
		if (node.kind === 'text' || text[node.start] !== typed || node.end <= caret) continue;
		let closer = node.end;
		while (closer > caret && text[closer - 1] === typed) closer--;
		if (closer <= caret) return true;
	}
	return false;
}

// A construct of `typed`'s family ends exactly at `end`, its last byte in the closing run. The
// scan's bound grows past the content by the byte a caller has just inserted.
function closerEndsAt(
	text: string,
	content: ContentRange,
	end: number,
	typed: string,
	grammar: GrammarView
): boolean {
	const bound = Math.max(content.end, end);
	for (const node of inlineDescendants(
		parseInline(text, content.start, bound, undefined, grammar)
	)) {
		if (node.kind === 'text' || node.end !== end || text[end - 1] !== typed) continue;
		const inner = constructContentRange(node);
		if (!inner || inner.end < end) return true;
	}
	return false;
}

function constructAt(
	text: string,
	content: ContentRange,
	start: number,
	end: number,
	grammar: GrammarView
): boolean {
	for (const node of inlineDescendants(
		parseInline(text, content.start, content.end, undefined, grammar)
	)) {
		if (node.kind !== 'text' && node.start === start && node.end === end) return true;
	}
	return false;
}
