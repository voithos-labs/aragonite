/**
 * A typed inline delimiter (`$`, backtick, `*`, `_`, `~~`) writes its partner after the caret, so
 * it cannot pair with a later run on the line. Typing the partner steps past it, and an empty pair
 * the auto-pair wrote (`auto-pair-record.ts`) drops its partner when the first byte inside makes
 * it no construct. Every prose block runs `applyDelimiterAutoPair` on `beforeinput` (G4.65).
 */

import {
	constructContentRange,
	inlineDescendants,
	readInline,
	type ContentRange
} from '../../../core/inline';
import { isAutoPairTrigger } from '../../../core/inline/scan/plugin-syntax';
import type { GrammarView } from '../../../schema/block-openers';
import type { Reading } from '../../../schema/reading';
import type { BlockAutoPairs } from './auto-pair-record';

export type AutoPairEdit =
	/** `pair` is the empty pair the write leaves around the caret, which the auto-pair owns. */
	| { kind: 'write'; text: string; caret: number; pair?: ContentRange }
	/** The typed byte completed a construct's closer; what follows belongs outside it. */
	| { kind: 'close'; text: string; caret: number }
	/** Nothing written: the caret passes its partner. Over a construct's closer that run may be
	 *  hidden, and then only the side changes, which the block records as an arrival side.
	 *  `pair` is the auto-pair's own empty pair the caret stepped past. */
	| { kind: 'step-over'; caret: number; overConstruct: boolean; pair?: ContentRange };

/** What the resolver reads about the line besides its bytes. */
export interface AutoPairContext {
	/** The empty pair the auto-pair wrote at this caret, or null: the same bytes typed by hand
	 *  are the user's, and a key between them touches one byte. */
	ownPair: ContentRange | null;
	/** Whether the written line still parses as this block: a grown `****` is a thematic break
	 *  and `~~~~` a fence, so such a pair steps past its partner instead. */
	keepsKind?: (text: string) => boolean;
}

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
 * inside it. `reading` carries the link definitions and grammar the block was drawn with.
 */
export function resolveDelimiterAutoPair(
	text: string,
	content: ContentRange,
	caret: number,
	typed: string,
	reading: Reading,
	{ ownPair, keepsKind = () => true }: AutoPairContext
): AutoPairEdit | null {
	if (typed.length !== 1 || caret < content.start || caret > content.end) return null;
	const before = text[caret - 1];
	const after = text[caret];
	const policy = policyOf(typed, reading.grammar);
	const inside = ownPair && isBetweenRuns(ownPair, caret) ? ownPair : null;
	if (!policy) return inside && collapseEmptyPair(text, content, caret, typed, inside, reading);
	if (after === typed && closingRunAt(text, content, caret, typed, reading)) {
		return { kind: 'step-over', caret: caret + 1, overConstruct: true };
	}
	const paired = text.slice(0, caret) + typed + text.slice(caret);
	// The typed byte lengthens the content, so a scan of the paired line reads one byte further.
	const pairedContent = { start: content.start, end: content.end + 1 };
	if (closerEndsAt(paired, pairedContent, caret + 1, typed, reading)) {
		return { kind: 'close', text: paired, caret: caret + 1 };
	}
	const pair = (next: string, pairRange: ContentRange): AutoPairEdit | null => {
		if (keepsKind(next)) return write(next, caret + 1, pairRange);
		if (after !== typed || !inside) return null;
		return { kind: 'step-over', caret: caret + 1, overConstruct: false, pair: inside };
	};
	if (after === typed) {
		// A pair the user typed, or a byte in front of another run's opener, is spelling something
		// out: only the auto-pair's own empty pair is stepped over or grown.
		if (!inside) return null;
		if (policy.inside === 'step-over') {
			return { kind: 'step-over', caret: caret + 1, overConstruct: false, pair: inside };
		}
		const grown = text.slice(0, caret) + typed + typed + text.slice(caret);
		return pair(grown, { start: inside.start, end: inside.end + 2 });
	}
	if (before === typed && !closerEndsAt(text, content, caret, typed, reading)) {
		// `~|` plus `~`: the double run this delimiter pairs on, as long as it is a lone run.
		const single = text[caret - 2] !== typed;
		if (policy.inside === 'grow' && single) {
			const grown = text.slice(0, caret) + typed.repeat(3) + text.slice(caret);
			return pair(grown, { start: caret - 1, end: caret + 3 });
		}
		return null;
	}
	if (!policy.single || (policy.notAfterWord && isWordByte(before))) return null;
	const opened = text.slice(0, caret) + typed + typed + text.slice(caret);
	return pair(opened, { start: caret, end: caret + 2 });
}

/**
 * Inside a construct whose source is showing (`$ab|$`) the partner is the real closer, and typing
 * it means "done": the caret steps past it and the caller hides the source, so it renders at once.
 */
export function stepsOverRevealedCloser(
	text: string,
	caret: number,
	typed: string,
	grammar: GrammarView
): boolean {
	return typed.length === 1 && policyOf(typed, grammar) !== null && text[caret] === typed;
}

/** Backspace at the auto-pair's own empty pair takes both runs, between them (`**|**`) or right
 *  after a stepped-over one (`$$|`), as it does in any IDE. */
export function resolveEmptyPairBackspace(
	text: string,
	caret: number,
	ownPair: ContentRange | null,
	grammar: GrammarView
): AutoPairEdit | null {
	if (!ownPair) return null;
	// The emphasis family grows instead of stepping, so its `**|` is a double opener to type after.
	const stepped =
		caret === ownPair.end && policyOf(text[caret - 1], grammar)?.inside === 'step-over';
	if (!isBetweenRuns(ownPair, caret) && !stepped) return null;
	return write(text.slice(0, ownPair.start) + text.slice(ownPair.end), ownPair.start);
}

const write = (text: string, caret: number, pair?: ContentRange): AutoPairEdit =>
	pair ? { kind: 'write', text, caret, pair } : { kind: 'write', text, caret };

// The caret splits the empty pair into its two equal runs.
function isBetweenRuns(pair: ContentRange, caret: number): boolean {
	return caret > pair.start && caret - pair.start === pair.end - caret;
}

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
	/** How the block was drawn: a plugin's delimiter pairs only where the plugin is listed, a
	 *  reference link reads as the link it draws, and a hidden closer a step-over passes moves only
	 *  the arrival side. */
	reading: Reading;
	/** This block's view of the editor's record of the pair the auto-pair last wrote. */
	ownPairs: BlockAutoPairs;
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
	const ownPair = surface.ownPairs.consult(text, caret);
	if (surface.isRevealing()) {
		if (!typing || !stepsOverRevealedCloser(text, caret, e.data ?? '', surface.reading.grammar)) {
			return false;
		}
		e.preventDefault();
		surface.setCaret(caret + 1);
		void surface.foldReveal()?.settled;
		return true;
	}
	const edit = typing
		? resolveDelimiterAutoPair(text, surface.content(), caret, e.data ?? '', surface.reading, {
				ownPair,
				keepsKind: surface.keepsBlockKind
			})
		: resolveEmptyPairBackspace(text, caret, ownPair, surface.reading.grammar);
	if (!edit) return false;
	e.preventDefault();
	noteOwnPair(surface.ownPairs, text, edit);
	switch (edit.kind) {
		case 'step-over':
			if (edit.overConstruct && surface.reading.hidesDelimitersAtCaret()) surface.seatOutside();
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

/** Keep the record in step with an edit the auto-pair made to `text`: a pair it wrote or stepped
 *  past stays its own, and every other edit ends the pair. */
export function noteOwnPair(ownPairs: BlockAutoPairs, text: string, edit: AutoPairEdit): void {
	const pair = edit.kind === 'close' ? undefined : edit.pair;
	if (!pair) ownPairs.forget();
	else ownPairs.remember(edit.kind === 'write' ? edit.text : text, pair);
}

// ── Constructs ───────────────────────────────────────────────────────────────

// `X|X` plus the typed byte: keep the partner run only if the pair then parses as a construct.
function collapseEmptyPair(
	text: string,
	content: ContentRange,
	caret: number,
	typed: string,
	own: ContentRange,
	reading: Reading
): AutoPairEdit | null {
	const paired = text.slice(0, caret) + typed + text.slice(caret);
	const shifted = { start: content.start, end: content.end + 1 };
	if (constructAt(paired, shifted, own.start, own.end + 1, reading)) return null;
	const k = caret - own.start;
	return write(text.slice(0, caret) + typed + text.slice(caret + k), caret + 1);
}

// The caret sits inside or at the start of the closing run of a construct this delimiter both
// opens and closes, so the byte under it is that construct's own closer.
function closingRunAt(
	text: string,
	content: ContentRange,
	caret: number,
	typed: string,
	reading: Reading
): boolean {
	for (const node of inlineDescendants(
		readInline(text, content.start, content.end, reading.resolver, reading.grammar)
	)) {
		if (node.kind === 'text' || text[node.start] !== typed || node.end <= caret) continue;
		let closer = node.end;
		while (closer > caret && text[closer - 1] === typed) closer--;
		if (closer <= caret) return true;
	}
	return false;
}

// A construct of `typed`'s family ends exactly at `end`, its last byte in the closing run.
function closerEndsAt(
	text: string,
	content: ContentRange,
	end: number,
	typed: string,
	reading: Reading
): boolean {
	for (const node of inlineDescendants(
		readInline(text, content.start, content.end, reading.resolver, reading.grammar)
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
	reading: Reading
): boolean {
	for (const node of inlineDescendants(
		readInline(text, content.start, content.end, reading.resolver, reading.grammar)
	)) {
		if (node.kind !== 'text' && node.start === start && node.end === end) return true;
	}
	return false;
}
