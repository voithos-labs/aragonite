/**
 * The link destination and title grammar (CommonMark §6.3), read by inline links and by link
 * reference definitions (§4.7) alike. Each reader returns where its span ends and the value the
 * spec derives from it; the whitespace between the parts is each caller's rule. The inverse
 * writer is `destination-bytes.ts`.
 */

import { ESCAPABLE_PUNCTUATION } from '../escapable';
import { processDestination, unescapeSpecString } from './scan/url';

export interface LinkDestination {
	/** Escapes and entities resolved, then percent-encoded. */
	url: string;
	end: number;
}

export interface LinkTitle {
	/** Escapes and entities resolved. */
	title: string;
	end: number;
}

/** A scan that reached `end` inside an open title; more text may still close it. */
export const TITLE_OPEN = -2;
const NOT_A_TITLE = -1;

// ── Destinations ────────────────────────────────────────────────────────────

/** A bare destination is empty only just before a `)`, which only an inline link can close on. */
export function parseLinkDestination(
	raw: string,
	pos: number,
	end: number
): LinkDestination | null {
	if (pos < end && raw[pos] === '<') return parseAngleDestination(raw, pos, end);
	return parseBareDestination(raw, pos, end);
}

function parseAngleDestination(raw: string, pos: number, end: number): LinkDestination | null {
	let i = pos + 1;
	while (i < end) {
		const ch = raw[i];
		if (ch === '>') return { url: processDestination(raw.slice(pos + 1, i)), end: i + 1 };
		if (ch === '<' || ch === '\n' || ch === '\u0000') return null;
		if (ch === '\\') {
			const next = i + 1 < end ? raw[i + 1] : '';
			if (next === '' || next === '\n' || next === '\r' || next === ' ' || next === ' ') {
				return null;
			}
			i += 2;
		} else {
			i++;
		}
	}
	return null;
}

// commonmark.js's terminator set: other control characters, and U+00A0, are destination content.
const DESTINATION_TERMINATORS = new Set(' \t\n\u000b\u000c\r');

/** Parentheses must balance, at any depth. */
function parseBareDestination(raw: string, pos: number, end: number): LinkDestination | null {
	let i = pos;
	let openParens = 0;
	while (i < end) {
		const ch = raw[i];
		if (ch === '\\' && i + 1 < end && ESCAPABLE_PUNCTUATION.has(raw[i + 1])) {
			i += 2;
		} else if (ch === '(') {
			openParens++;
			i++;
		} else if (ch === ')') {
			if (openParens < 1) break;
			openParens--;
			i++;
		} else if (DESTINATION_TERMINATORS.has(ch)) {
			break;
		} else {
			i++;
		}
	}
	if (i === pos && (i >= end || raw[i] !== ')')) return null;
	if (openParens !== 0) return null;
	return { url: processDestination(raw.slice(pos, i)), end: i };
}

// ── Titles ──────────────────────────────────────────────────────────────────

export function parseLinkTitle(raw: string, pos: number, end: number): LinkTitle | null {
	const titleEnd = scanLinkTitle(raw, pos, end, pos + 1);
	return titleEnd < 0 ? null : { title: linkTitleValue(raw, pos, titleEnd), end: titleEnd };
}

/**
 * Where the title opening at `pos` ends: the offset past its closer, `TITLE_OPEN`, or a negative
 * miss. `from` resumes an open scan at the `end` it stopped on, once the caller has more text.
 */
export function scanLinkTitle(raw: string, pos: number, end: number, from: number): number {
	const marker = raw[pos];
	if (marker !== '"' && marker !== "'" && marker !== '(') return NOT_A_TITLE;
	const close = marker === '(' ? ')' : marker;
	let i = from;
	while (i < end) {
		const ch = raw[i];
		if (ch === close) return i + 1;
		// A paren title cannot nest.
		if (ch === '\u0000' || (marker === '(' && ch === '(')) return NOT_A_TITLE;
		if (ch === '\\' && i + 1 < end) i += 2;
		else i++;
	}
	return TITLE_OPEN;
}

/** The value of the title spanning `pos` to `titleEnd`, a span `scanLinkTitle` accepted. */
export function linkTitleValue(raw: string, pos: number, titleEnd: number): string {
	return unescapeSpecString(raw.slice(pos + 1, titleEnd - 1));
}
