/**
 * Bracket stack — inline links and images (CommonMark §6.3), a port of the
 * reference parseOpenBracket/parseBang/parseCloseBracket onto the flat
 * working-node list. A failed `]` leaves its brackets as literal text with
 * any inner nodes standing; reference-link forms are the resolver task's.
 *
 * `url`/`title` carry the reference AST's spec-processed values (backslash
 * escapes resolved, entities decoded, destinations percent-encoded); offsets
 * stay lossless — serialization never reads these fields.
 */

import type { InlineNode } from '../../nodes';
import { matchCharacterReference } from '../character-refs';
import { ESCAPABLE_PUNCTUATION } from '../escapes';
import { parseImageDimensions } from '../image-dimensions';
import { mergeAdjacentText } from '../post-process';
import { processEmphasis } from './emphasis';
import { appendNode, flushPendingText, type ScanContext } from './scan-state';

// ── Scan-time handlers ──────────────────────────────────────────────────────

export function handleOpenBracket(ctx: ScanContext): void {
	pushBracket(ctx, false);
}

export function handleBang(ctx: ScanContext): void {
	if (ctx.pos + 1 < ctx.end && ctx.raw[ctx.pos + 1] === '[') pushBracket(ctx, true);
	else ctx.pos++;
}

function pushBracket(ctx: ScanContext, isImage: boolean): void {
	const start = ctx.pos;
	const end = start + (isImage ? 2 : 1);
	appendNode(ctx, { kind: 'text', start, end, text: ctx.raw.slice(start, end) });
	ctx.brackets.push({
		nodeIndex: ctx.nodes.length - 1,
		isImage,
		active: true,
		delimiterFloor: ctx.delimiters.length
	});
}

export function handleCloseBracket(ctx: ScanContext): void {
	const bracket = ctx.brackets[ctx.brackets.length - 1];
	if (bracket === undefined) {
		ctx.pos++;
		return;
	}
	if (!bracket.active) {
		ctx.brackets.pop();
		ctx.pos++;
		return;
	}

	const labelEnd = ctx.pos;
	const tail = parseInlineLinkTail(ctx.raw, labelEnd + 1, ctx.end);
	if (tail === null) {
		ctx.brackets.pop();
		ctx.pos++;
		return;
	}

	ctx.brackets.pop();
	flushPendingText(ctx, labelEnd);
	processEmphasis(ctx, bracket.delimiterFloor);

	const opener = ctx.nodes[bracket.nodeIndex];
	const children = mergeAdjacentText(ctx.nodes.splice(bracket.nodeIndex + 1));
	ctx.nodes[bracket.nodeIndex] = bracket.isImage
		? buildImage(ctx.raw, opener, labelEnd, tail, children)
		: buildLink(opener, tail, children);
	ctx.pos = tail.end;
	ctx.textStart = tail.end;

	// §6.3: no links inside links — a matched link deactivates every
	// enclosing link opener; image openers stay live.
	if (!bracket.isImage) {
		for (const open of ctx.brackets) {
			if (!open.isImage) open.active = false;
		}
	}
}

function buildLink(opener: InlineNode, tail: InlineLinkTail, children: InlineNode[]): InlineNode {
	return {
		kind: 'link',
		start: opener.start,
		end: tail.end,
		children,
		url: tail.url,
		...(tail.title !== undefined ? { title: tail.title } : {})
	};
}

function buildImage(
	raw: string,
	opener: InlineNode,
	labelEnd: number,
	tail: InlineLinkTail,
	children: InlineNode[]
): InlineNode {
	const dims = parseImageDimensions(raw.slice(opener.end, labelEnd));
	return {
		kind: 'image',
		start: opener.start,
		end: tail.end,
		children,
		alt: dims.displayAlt,
		url: tail.url,
		...(tail.title !== undefined ? { title: tail.title } : {}),
		...(dims.width !== undefined ? { width: dims.width } : {}),
		...(dims.height !== undefined ? { height: dims.height } : {})
	};
}

// ── Inline-link tail: "(" destination title? ")" ────────────────────────────

interface InlineLinkTail {
	url: string;
	title?: string;
	/** Offset just past the closing ')'. */
	end: number;
}

function parseInlineLinkTail(raw: string, pos: number, end: number): InlineLinkTail | null {
	if (pos >= end || raw[pos] !== '(') return null;
	let i = skipSpnl(raw, pos + 1, end);
	const dest = parseDestination(raw, i, end);
	if (dest === null) return null;
	i = skipSpnl(raw, dest.end, end);

	// A title needs real whitespace after the destination: a quote abutting
	// it is destination content (the quote-split rule).
	let title: string | undefined;
	if (i > dest.end) {
		const parsed = parseTitle(raw, i, end);
		if (parsed !== null) {
			title = parsed.title;
			i = skipSpnl(raw, parsed.end, end);
		}
	}
	if (i >= end || raw[i] !== ')') return null;
	return { url: dest.url, ...(title !== undefined ? { title } : {}), end: i + 1 };
}

/** The reference's spnl: spaces, at most one newline, spaces — tabs excluded. */
function skipSpnl(raw: string, pos: number, end: number): number {
	while (pos < end && raw[pos] === ' ') pos++;
	if (pos < end && raw[pos] === '\n') {
		pos++;
		while (pos < end && raw[pos] === ' ') pos++;
	}
	return pos;
}

function parseDestination(
	raw: string,
	pos: number,
	end: number
): { url: string; end: number } | null {
	if (pos < end && raw[pos] === '<') return parseAngleDestination(raw, pos, end);
	return parseBareDestination(raw, pos, end);
}

/** `<…>` form: no unescaped `<`/`>`/newline inside; a backslash escapes any non-newline char. */
function parseAngleDestination(
	raw: string,
	pos: number,
	end: number
): { url: string; end: number } | null {
	let i = pos + 1;
	while (i < end) {
		const ch = raw[i];
		if (ch === '>') return { url: processDestination(raw.slice(pos + 1, i)), end: i + 1 };
		if (ch === '<' || ch === '\n' || ch === '\u0000') return null;
		if (ch === '\\') {
			const next = i + 1 < end ? raw[i + 1] : '';
			if (next === '' || next === '\n' || next === '\r' || next === '\u2028' || next === '\u2029') {
				return null;
			}
			i += 2;
		} else {
			i++;
		}
	}
	return null;
}

// The reference's destination terminator set (reWhitespaceChar): other
// control characters — and U+00A0 — are destination content.
const DESTINATION_TERMINATORS = new Set(' \t\n\u000b\u000c\r');

/**
 * Bare form: balanced unescaped parens with no depth cap, backslash consumes
 * a following escapable char, terminates on ASCII whitespace. Empty is valid
 * only immediately before the closing `)`.
 */
function parseBareDestination(
	raw: string,
	pos: number,
	end: number
): { url: string; end: number } | null {
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

/** `"…"`, `'…'`, or `(…)` title; backslash consumes the next char; paren titles cannot nest. */
function parseTitle(raw: string, pos: number, end: number): { title: string; end: number } | null {
	const marker = raw[pos];
	if (marker !== '"' && marker !== "'" && marker !== '(') return null;
	const close = marker === '(' ? ')' : marker;
	let i = pos + 1;
	while (i < end) {
		const ch = raw[i];
		if (ch === close) return { title: unescapeSpecString(raw.slice(pos + 1, i)), end: i + 1 };
		if (ch === '\u0000' || (marker === '(' && ch === '(')) return null;
		if (ch === '\\' && i + 1 < end) i += 2;
		else i++;
	}
	return null;
}

// ── Spec destination/title processing ───────────────────────────────────────

function processDestination(rawDest: string): string {
	return percentEncodeUri(unescapeSpecString(rawDest));
}

/** The reference's unescapeString: backslash escapes resolved, entities decoded. */
function unescapeSpecString(s: string): string {
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
function percentEncodeUri(s: string): string {
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
