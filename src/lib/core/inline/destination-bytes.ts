/**
 * The inverse of `link-destination.ts` for the two fields every bracketed construct hides: a
 * destination and a title. Reading the written bytes gives the value back, so the image and link
 * write paths cannot change a url or title the user did not edit.
 */

import { matchCharacterReference } from './character-refs';

// ── Destinations ────────────────────────────────────────────────────────────

/**
 * A bare destination (CommonMark §6.3) for `url`. Bytes the reader would percent-encode anyway
 * are written encoded, so nothing ends the destination early; a parenthesis stays as written
 * when all of them balance and is escaped otherwise.
 */
export function encodeDestination(url: string): string {
	const escapeParens = !parensBalance(url);
	let out = '';
	for (let i = 0; i < url.length; i++) {
		const ch = url[i];
		if (DESTINATION_ENCODED.has(ch)) out += percentEncoded(ch);
		else if ((ch === '(' || ch === ')') && escapeParens) out += '\\' + ch;
		else out += escapedAmpersand(url, i) + ch;
	}
	return out;
}

// The reader percent-encodes each of these anyway, so encoding them changes no value; left raw,
// whitespace would end the destination, `<` open the angle form, a backslash escape a byte.
const DESTINATION_ENCODED = new Set(' \t\r\n\u000b\u000c"<>\\');

function percentEncoded(ch: string): string {
	return '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
}

function parensBalance(url: string): boolean {
	let depth = 0;
	for (const ch of url) {
		if (ch === '(') depth++;
		else if (ch === ')' && --depth < 0) return false;
	}
	return depth === 0;
}

// ── Titles ──────────────────────────────────────────────────────────────────

/** A title's bytes for the double-quoted form. */
export function escapeTitle(title: string): string {
	let out = '';
	for (let i = 0; i < title.length; i++) {
		const ch = title[i];
		out += ch === '\\' || ch === '"' ? '\\' + ch : escapedAmpersand(title, i) + ch;
	}
	return out;
}

// ── Shared ──────────────────────────────────────────────────────────────────

/** The backslash an `&` needs when the text after it would read as a character reference. */
function escapedAmpersand(text: string, at: number): string {
	if (text[at] !== '&') return '';
	return matchCharacterReference(text, at, text.length)?.decoded !== undefined ? '\\' : '';
}
