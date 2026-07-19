/**
 * Spec destination/title processing — the reference's unescapeString +
 * normalizeURI pair, applied to link destinations and autolink targets.
 * Offsets stay lossless; serialization never reads the processed values.
 */

import { matchCharacterReference } from '../character-refs';
import { ESCAPABLE_PUNCTUATION } from '../../escapable';

export function processDestination(rawDest: string): string {
	return percentEncodeUri(unescapeSpecString(rawDest));
}

/** The reference's unescapeString: backslash escapes resolved, entities decoded. */
export function unescapeSpecString(s: string): string {
	let out = '';
	let i = 0;
	while (i < s.length) {
		const ch = s[i];
		if (ch === '\\' && i + 1 < s.length && ESCAPABLE_PUNCTUATION.has(s[i + 1])) {
			out += s[i + 1];
			i += 2;
			continue;
		}
		if (ch === '&') {
			const ref = matchCharacterReference(s, i, s.length);
			if (ref !== null && ref.decoded !== undefined) {
				out += ref.decoded;
				i = ref.end;
				continue;
			}
		}
		out += ch;
		i++;
	}
	return out;
}

// The mdurl encode() kept set — commonmark.js normalizes destinations
// through it, so the differ needs byte-equal output.
const URI_SAFE = buildUriSafeTable(";/?:@&=+$,-_.!~*'()#");

function buildUriSafeTable(kept: string): boolean[] {
	const safe = new Array<boolean>(128).fill(false);
	for (let code = 0x30; code <= 0x39; code++) safe[code] = true;
	for (let code = 0x41; code <= 0x5a; code++) safe[code] = true;
	for (let code = 0x61; code <= 0x7a; code++) safe[code] = true;
	for (const ch of kept) safe[ch.charCodeAt(0)] = true;
	return safe;
}

const HEX_PAIR = /^[0-9a-f]{2}$/i;

/**
 * mdurl-style percent-encoding: keeps valid `%XX` sequences, encodes other
 * ASCII outside the kept set with uppercase hex, UTF-8 percent-encodes the
 * rest; a lone surrogate becomes the encoded replacement character.
 */
export function percentEncodeUri(s: string): string {
	let out = '';
	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i);
		if (code === 0x25 && i + 2 < s.length && HEX_PAIR.test(s.slice(i + 1, i + 3))) {
			out += s.slice(i, i + 3);
			i += 2;
			continue;
		}
		if (code < 128) {
			out += URI_SAFE[code] ? s[i] : '%' + code.toString(16).toUpperCase().padStart(2, '0');
			continue;
		}
		if (code >= 0xd800 && code <= 0xdfff) {
			if (code <= 0xdbff && i + 1 < s.length) {
				const next = s.charCodeAt(i + 1);
				if (next >= 0xdc00 && next <= 0xdfff) {
					out += encodeURIComponent(s[i] + s[i + 1]);
					i++;
					continue;
				}
			}
			out += '%EF%BF%BD';
			continue;
		}
		out += encodeURIComponent(s[i]);
	}
	return out;
}
