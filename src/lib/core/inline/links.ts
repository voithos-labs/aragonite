/**
 * Inline pipeline stage 1.5: link, image, and autolink scanning over the text
 * regions left by earlier pre-passes (backticks, escapes, entity references).
 *
 * The links.ts ↔ index.ts module cycle is benign: parseInline is called at
 * runtime, not module-init.
 */

import type { InlineNode } from '../nodes';
import { parseImageDimensions } from '../../components/image/image-dimensions';
import { parseInline } from './index';

type Range = { start: number; end: number };

// ── GFM §6.9 shared helpers ─────────────────────────────────────────────────

const TRAILING_PUNCT = new Set(['?', '!', '.', ',', ':', '*', '_', '~']);

/**
 * Trim trailing punctuation per GFM §6.9. Returns the adjusted end offset.
 *
 * Always strips: ? ! . , : * _ ~
 * Conditional ): only when there are more `)` than `(` in [urlStart, end).
 * Conditional ;: only when the part before is NOT shaped like an HTML entity
 * (a `;` preceded by `&` followed by alphanumerics / `#` and digits/hex back to `&`).
 */
export function trimTrailingPunctuation(raw: string, urlStart: number, urlEnd: number): number {
	let end = urlEnd;
	while (end > urlStart) {
		const ch = raw[end - 1];
		if (TRAILING_PUNCT.has(ch)) {
			end--;
			continue;
		}
		if (ch === ')') {
			let opens = 0;
			let closes = 0;
			for (let i = urlStart; i < end; i++) {
				if (raw[i] === '(') opens++;
				else if (raw[i] === ')') closes++;
			}
			if (closes > opens) {
				end--;
				continue;
			}
			break;
		}
		if (ch === ';') {
			// Look back for &name; / &#NNN; / &#xHHH;
			let j = end - 2;
			while (j > urlStart && /[0-9A-Fa-f]/.test(raw[j])) j--;
			if (j >= urlStart + 2 && raw[j] === 'x' && raw[j - 1] === '#' && raw[j - 2] === '&') {
				break;
			}
			j = end - 2;
			while (j > urlStart && /[0-9]/.test(raw[j])) j--;
			if (j >= urlStart + 1 && raw[j] === '#' && raw[j - 1] === '&') {
				break;
			}
			j = end - 2;
			while (j > urlStart && /[A-Za-z0-9]/.test(raw[j])) j--;
			if (j >= urlStart && raw[j] === '&' && j < end - 2) {
				break;
			}
			end--;
			continue;
		}
		break;
	}
	return end;
}

/**
 * Per GFM §6.9: a bare autolink is valid only at start-of-region or after
 * whitespace, `*`, `_`, `~`, or `(`.
 */
export function isValidLeadingBoundary(raw: string, pos: number, regionStart: number): boolean {
	if (pos <= regionStart) return true;
	const ch = raw[pos - 1];
	return /\s/.test(ch) || ch === '*' || ch === '_' || ch === '~' || ch === '(';
}

// ── Public entry ────────────────────────────────────────────────────────────

export function scanLinksAndAutolinks(
	raw: string,
	start: number,
	end: number,
	occupied: InlineNode[]
): InlineNode[] {
	const occupiedRanges: Range[] = occupied
		.filter((n) => n.kind !== 'text')
		.map((n) => ({ start: n.start, end: n.end }));

	// Pass 1: links and images may span occupied ranges (entity in link text,
	// escape inside alt, etc.). Bracket pairing skips over occupied content so
	// `[` inside a code span doesn't masquerade as a link delimiter.
	const linksAndImages = scanLinksAndImages(raw, start, end, occupiedRanges);

	// Pass 2: autolinks fill the gaps left by occupied + links. They still stop
	// at occupied/whitespace boundaries — preserving the 0.6.2 behavior where
	// `https://x.com&amp;y` doesn't absorb the entity.
	const closedRanges: Range[] = [
		...occupiedRanges,
		...linksAndImages.map((n) => ({ start: n.start, end: n.end }))
	].sort((a, b) => a.start - b.start);

	const autolinks: InlineNode[] = [];
	let pos = start;
	for (const range of closedRanges) {
		scanRegionForAutolinks(raw, pos, range.start, autolinks);
		pos = range.end;
	}
	scanRegionForAutolinks(raw, pos, end, autolinks);

	const found: InlineNode[] = [...linksAndImages, ...autolinks];
	if (found.length === 0) return occupied;

	const allOccupied: InlineNode[] = [...occupied.filter((n) => n.kind !== 'text'), ...found].sort(
		(a, b) => a.start - b.start
	);

	const result: InlineNode[] = [];
	let cursor = start;

	for (const node of allOccupied) {
		if (cursor < node.start) {
			result.push({
				kind: 'text',
				start: cursor,
				end: node.start,
				text: raw.slice(cursor, node.start)
			});
		}
		result.push(node);
		cursor = node.end;
	}
	if (cursor < end) {
		result.push({
			kind: 'text',
			start: cursor,
			end,
			text: raw.slice(cursor, end)
		});
	}

	return result;
}

// ── Links and images ───────────────────────────────────────────────────────

/**
 * Parse `(url "title")` starting at `(`. Angle-bracket URLs (`<url>`) are
 * NOT decoded: the brackets survive in the url field. Safe because url is
 * a rendering cache — never re-serialized.
 */
function parseDestination(
	raw: string,
	pos: number,
	limit: number
): { url: string; title: string | undefined; end: number } | null {
	if (pos >= limit || raw[pos] !== '(') return null;
	pos++;

	while (pos < limit && (raw[pos] === ' ' || raw[pos] === '\t')) pos++;

	const urlStart = pos;
	while (
		pos < limit &&
		raw[pos] !== ')' &&
		raw[pos] !== ' ' &&
		raw[pos] !== '\t' &&
		raw[pos] !== '"' &&
		raw[pos] !== "'"
	) {
		pos++;
	}
	const url = raw.slice(urlStart, pos);

	while (pos < limit && (raw[pos] === ' ' || raw[pos] === '\t')) pos++;

	let title: string | undefined;
	if (pos < limit && (raw[pos] === '"' || raw[pos] === "'")) {
		const quote = raw[pos];
		pos++;
		const titleStart = pos;
		while (pos < limit && raw[pos] !== quote) pos++;
		if (pos >= limit) return null;
		title = raw.slice(titleStart, pos);
		pos++;
	}

	while (pos < limit && (raw[pos] === ' ' || raw[pos] === '\t')) pos++;

	if (pos >= limit || raw[pos] !== ')') return null;
	pos++;

	return { url, title, end: pos };
}

function scanLinksAndImages(
	raw: string,
	start: number,
	end: number,
	occupied: Range[]
): InlineNode[] {
	const out: InlineNode[] = [];
	let pos = start;

	while (pos < end) {
		const skip = occupiedEndAt(occupied, pos);
		if (skip !== null) {
			pos = skip;
			continue;
		}

		const ch = raw[pos];

		if (
			ch === '!' &&
			pos + 1 < end &&
			raw[pos + 1] === '[' &&
			occupiedEndAt(occupied, pos + 1) === null
		) {
			const bracketOpen = pos + 1;
			const bracketClose = findMatchingBracket(raw, bracketOpen, end, occupied);
			if (bracketClose !== -1) {
				const dest = parseDestination(raw, bracketClose + 1, end);
				if (dest !== null) {
					const altRaw = raw.slice(bracketOpen + 1, bracketClose);
					const dims = parseImageDimensions(altRaw);
					out.push({
						kind: 'image',
						start: pos,
						end: dest.end,
						alt: dims.displayAlt,
						url: dest.url,
						...(dest.title !== undefined ? { title: dest.title } : {}),
						...(dims.width !== undefined ? { width: dims.width } : {}),
						...(dims.height !== undefined ? { height: dims.height } : {})
					});
					pos = dest.end;
					continue;
				}
			}
			pos++;
			continue;
		}

		if (ch === '[') {
			const bracketClose = findMatchingBracket(raw, pos, end, occupied);
			if (bracketClose !== -1) {
				const dest = parseDestination(raw, bracketClose + 1, end);
				if (dest !== null) {
					const children = parseInline(raw, pos + 1, bracketClose);
					out.push({
						kind: 'link',
						start: pos,
						end: dest.end,
						children,
						url: dest.url,
						...(dest.title !== undefined ? { title: dest.title } : {})
					});
					pos = dest.end;
					continue;
				}
			}
			pos++;
			continue;
		}

		pos++;
	}

	return out;
}

/** End of the occupied range covering `pos`, or null if `pos` is free. */
function occupiedEndAt(occupied: Range[], pos: number): number | null {
	for (const range of occupied) {
		if (pos >= range.end) continue;
		if (pos < range.start) return null;
		return range.end;
	}
	return null;
}

function findMatchingBracket(
	raw: string,
	bracketStart: number,
	limit: number,
	occupied: Range[]
): number {
	let depth = 0;
	let pos = bracketStart;
	while (pos < limit) {
		const skip = occupiedEndAt(occupied, pos);
		if (skip !== null) {
			pos = skip;
			continue;
		}
		if (raw[pos] === '[') depth++;
		else if (raw[pos] === ']') {
			depth--;
			if (depth === 0) return pos;
		}
		pos++;
	}
	return -1;
}

// ── Autolink dispatcher ─────────────────────────────────────────────────────

function scanRegionForAutolinks(raw: string, start: number, end: number, out: InlineNode[]): void {
	let pos = start;
	while (pos < end) {
		const ch = raw[pos];
		let matched: InlineNode | null = null;

		if (ch === '<') {
			matched = matchAngleBracketAutolink(raw, pos, end);
		} else if (ch === 'h' || ch === 'H') {
			matched = matchBareHttpAutolink(raw, pos, start, end);
		} else if (ch === 'w' || ch === 'W') {
			matched = matchBareWwwAutolink(raw, pos, start, end);
		}

		if (matched !== null) {
			out.push(matched);
			pos = matched.end;
			continue;
		}
		pos++;
	}
}

function matchAngleBracketAutolink(raw: string, pos: number, end: number): InlineNode | null {
	const closeAngle = raw.indexOf('>', pos + 1);
	if (closeAngle === -1 || closeAngle >= end) return null;
	const inner = raw.slice(pos + 1, closeAngle);
	if (/^https?:\/\/\S+$/.test(inner)) {
		return {
			kind: 'autolink',
			start: pos,
			end: closeAngle + 1,
			url: inner
		};
	}
	return null;
}

function matchBareHttpAutolink(
	raw: string,
	pos: number,
	regionStart: number,
	end: number
): InlineNode | null {
	if (!isValidLeadingBoundary(raw, pos, regionStart)) return null;
	const lower = raw.slice(pos, pos + 8).toLowerCase();
	const schemeLen = lower.startsWith('https://') ? 8 : lower.startsWith('http://') ? 7 : 0;
	if (schemeLen === 0) return null;
	let urlEnd = pos + schemeLen;
	while (urlEnd < end && !/\s/.test(raw[urlEnd])) urlEnd++;
	if (urlEnd === pos + schemeLen) return null;
	urlEnd = trimTrailingPunctuation(raw, pos, urlEnd);
	if (urlEnd === pos + schemeLen) return null;
	return {
		kind: 'autolink',
		start: pos,
		end: urlEnd,
		url: raw.slice(pos, urlEnd)
	};
}

function matchBareWwwAutolink(
	raw: string,
	pos: number,
	regionStart: number,
	end: number
): InlineNode | null {
	if (!isValidLeadingBoundary(raw, pos, regionStart)) return null;
	const prefixLen = 4;
	const prefix = raw.slice(pos, pos + prefixLen).toLowerCase();
	if (prefix !== 'www.') return null;
	let urlEnd = pos + prefixLen;
	while (urlEnd < end && !/\s/.test(raw[urlEnd])) urlEnd++;
	if (urlEnd === pos + prefixLen) return null;
	urlEnd = trimTrailingPunctuation(raw, pos, urlEnd);
	if (urlEnd === pos + prefixLen) return null;
	return {
		kind: 'autolink',
		start: pos,
		end: urlEnd,
		url: raw.slice(pos, urlEnd)
	};
}
