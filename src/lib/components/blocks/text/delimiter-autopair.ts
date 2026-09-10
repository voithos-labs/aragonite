/**
 * A typed inline delimiter closes itself. A lone `$`, backtick, `*`, `_` or `~~` would pair with
 * whatever matching run comes later on the line, wrapping prose the user never meant, so the
 * keystroke lands its twin after the caret and the caret sits between them. Typing the closer over
 * the twin steps past it, so two presses type two bytes and a ``` fence is still three keystrokes;
 * the emphasis family grows instead (`*|*` and `*` is `**|**`). The empty pair drops its twin when
 * the first body byte makes it no construct (`$5` is a price). Wired into the prose surfaces.
 */

import { inlineDescendants } from '../../../core/inline/walk';
import { parseInline } from '../../../core/inline';
import { isAutoPairTrigger } from '../../../core/inline/scan/plugin-syntax';

export type AutoPairEdit =
	| { kind: 'write'; text: string; caret: number }
	/** Nothing written: the caret passes the twin. Over a construct's closer that run may be
	 *  unpainted, and then only the SIDE moves — the surface records it as an edge affinity. */
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

/**
 * What a single typed byte does at a collapsed caret, or null to leave the engine its insert.
 * `content` bounds the inline scan (a heading's `# ` is not prose); the caret must lie inside it.
 */
export function resolveDelimiterAutoPair(
	text: string,
	content: { start: number; end: number },
	caret: number,
	typed: string
): AutoPairEdit | null {
	if (typed.length !== 1 || caret < content.start || caret > content.end) return null;
	const before = text[caret - 1];
	const after = text[caret];
	const policy = policyOf(typed);
	if (!policy) return collapseEmptyPair(text, content, caret, typed);
	if (after === typed) {
		if (closingRunAt(text, content, caret, typed)) {
			return { kind: 'step-over', caret: caret + 1, overConstruct: true };
		}
		if (before === typed) {
			if (policy.inside === 'step-over') {
				return { kind: 'step-over', caret: caret + 1, overConstruct: false };
			}
			return write(text.slice(0, caret) + typed + typed + text.slice(caret), caret + 1);
		}
		// A byte in front of another run's opener is spelling something out, not opening a span.
		return null;
	}
	if (before === typed) {
		// `~|` plus `~`: the double run this delimiter pairs on, as long as it IS a lone run.
		const single = text[caret - 2] !== typed;
		if (policy.inside === 'grow' && single) {
			return write(text.slice(0, caret) + typed.repeat(3) + text.slice(caret), caret + 1);
		}
		return null;
	}
	if (!policy.single || (policy.notAfterWord && isWordByte(before))) return null;
	return write(text.slice(0, caret) + typed + typed + text.slice(caret), caret + 1);
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
function emptyPairAround(text: string, caret: number): { start: number; end: number } | null {
	const d = text[caret - 1];
	if (d === undefined || !policyOf(d)) return null;
	const k = runBefore(text, caret, d);
	if (k > 2 || runAfter(text, caret, d) !== k) return null;
	return { start: caret - k, end: caret + k };
}

// `XX|`: a stepped-over empty pair with the caret after it. Only the delimiters that step (the
// emphasis family grows instead, and its `**|` is a double opener with content ahead).
function emptyPairEnding(text: string, caret: number): { start: number; end: number } | null {
	const d = text[caret - 1];
	if (d === undefined || policyOf(d)?.inside !== 'step-over' || text[caret] === d) return null;
	if (runBefore(text, caret, d) !== 2) return null;
	return { start: caret - 2, end: caret };
}

// ── Constructs ───────────────────────────────────────────────────────────────

// `X|X` plus the typed byte: keep the twin run only if the pair then parses as a construct.
function collapseEmptyPair(
	text: string,
	content: { start: number; end: number },
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
function closingRunAt(
	text: string,
	content: { start: number; end: number },
	caret: number,
	typed: string
): boolean {
	for (const node of inlineDescendants(parseInline(text, content.start, content.end))) {
		if (node.kind === 'text' || text[node.start] !== typed || node.end <= caret) continue;
		let closer = node.end;
		while (closer > caret && text[closer - 1] === typed) closer--;
		if (closer <= caret) return true;
	}
	return false;
}

function constructAt(
	text: string,
	content: { start: number; end: number },
	start: number,
	end: number
): boolean {
	for (const node of inlineDescendants(parseInline(text, content.start, content.end))) {
		if (node.kind !== 'text' && node.start === start && node.end === end) return true;
	}
	return false;
}
