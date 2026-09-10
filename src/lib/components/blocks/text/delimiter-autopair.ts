/**
 * A typed inline delimiter closes itself. A lone `$` or backtick would pair with whatever
 * delimiter comes later on the line, wrapping prose the user never meant, so the keystroke lands
 * its twin after the caret and the caret sits between them. Typing the closer over the twin
 * steps past it: two presses type two bytes, and a ``` fence is still three keystrokes. The
 * empty pair drops its twin when the first body byte makes the pair no construct (`$5` is a
 * price, not math). Wired into the prose surfaces' `beforeinput`, beside the ranged-edit seam.
 */

import { inlineDescendants } from '../../../core/inline/walk';
import { parseInline } from '../../../core/inline';
import { isAutoPairTrigger } from '../../../core/inline/scan/plugin-syntax';

export type AutoPairEdit =
	| { kind: 'write'; text: string; caret: number }
	/** Nothing written: the caret passes the twin. Over a construct's closer that run may be
	 *  unpainted, and then only the SIDE moves — the surface records it as an edge affinity. */
	| { kind: 'step-over'; caret: number; overConstruct: boolean };

const BUILTIN_PAIR = '`';

function isPairDelimiter(ch: string): boolean {
	return ch === BUILTIN_PAIR || isAutoPairTrigger(ch);
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
	if (!isPairDelimiter(typed)) {
		return before !== undefined && before === after && isPairDelimiter(before)
			? collapseEmptyPair(text, content, caret, typed)
			: null;
	}
	if (after === typed) {
		if (before === typed) return { kind: 'step-over', caret: caret + 1, overConstruct: false };
		if (closesConstructAt(text, content, caret, typed)) {
			return { kind: 'step-over', caret: caret + 1, overConstruct: true };
		}
		// A byte in front of another span's opener is spelling something out, not opening a span.
		return null;
	}
	// Extending a run: the third backtick of a fence.
	if (before === typed) return null;
	const paired = text.slice(0, caret) + typed + typed + text.slice(caret);
	return { kind: 'write', text: paired, caret: caret + 1 };
}

/** Backspace at an empty pair takes both twins, between them (`$|$`) or right after them
 *  (`$$|`), as it does in any IDE. Exactly a pair: a longer run is a fence or a literal the user
 *  built by hand. */
export function resolveEmptyPairBackspace(text: string, caret: number): AutoPairEdit | null {
	const between = pairAround(text, caret - 1, caret);
	const after = between ? null : pairAround(text, caret - 2, caret - 1);
	const start = between ? caret - 1 : after ? caret - 2 : -1;
	if (start < 0) return null;
	return { kind: 'write', text: text.slice(0, start) + text.slice(start + 2), caret: start };
}

// `text[open]` and `text[close]` are the same pair delimiter, and nothing of it either side.
function pairAround(text: string, open: number, close: number): boolean {
	const d = text[open];
	if (open < 0 || d === undefined || d !== text[close] || !isPairDelimiter(d)) return false;
	return text[open - 1] !== d && text[close + 1] !== d;
}

/**
 * Inside a revealed source (`$ab|$`) the twin is the live closer, and typing it means "done":
 * the caret steps past it and the caller folds the reveal, so the formula renders at once.
 */
export function stepsOverRevealedCloser(text: string, caret: number, typed: string): boolean {
	return typed.length === 1 && isPairDelimiter(typed) && text[caret] === typed;
}

// `X|X` plus the typed byte: keep the twin only if `XtX` parses as a construct at the opener.
function collapseEmptyPair(
	text: string,
	content: { start: number; end: number },
	caret: number,
	typed: string
): AutoPairEdit | null {
	const paired = text.slice(0, caret) + typed + text.slice(caret);
	const shifted = { start: content.start, end: content.end + 1 };
	if (constructAt(paired, shifted, caret - 1, caret + 2)) return null;
	const dropped = text.slice(0, caret) + typed + text.slice(caret + 1);
	return { kind: 'write', text: dropped, caret: caret + 1 };
}

// The caret sits right before the closer of a construct this delimiter both opens and closes.
function closesConstructAt(
	text: string,
	content: { start: number; end: number },
	caret: number,
	typed: string
): boolean {
	for (const node of inlineDescendants(parseInline(text, content.start, content.end))) {
		if (node.kind !== 'text' && node.end === caret + 1 && text[node.start] === typed) return true;
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
