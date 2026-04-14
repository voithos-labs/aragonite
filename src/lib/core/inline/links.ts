/**
 * Stage 1.5 of the inline parser pipeline: link, image, and autolink scanning.
 * Consumes the text regions left untouched by backtick scanning and emits
 * link / image / autolink nodes. Used as input to the emphasis stage.
 */

import type { InlineNode } from '../nodes';
import { parseInline } from './index';

// NOTE: The import above creates a links.ts ↔ index.ts module cycle. This is
// benign — the call to parseInline inside scanRegionForLinksAndAutolinks is
// runtime-deferred, not module-init. ./index.ts is created in Task 5.

/**
 * Scan text regions (not occupied by code spans) for links, images, and autolinks.
 * Returns an updated node list where link/image/autolink nodes are spliced in
 * and the surrounding text nodes are trimmed accordingly.
 *
 * Occupied ranges (code spans + found links/images/autolinks) are used to ensure
 * Stage 2 treats their ranges as non-text.
 */
export function scanLinksAndAutolinks(
	raw: string,
	start: number,
	end: number,
	codeSpans: InlineNode[]
): InlineNode[] {
	// Build list of occupied ranges from code spans
	const occupied: Array<{ start: number; end: number }> = codeSpans
		.filter((n) => n.kind === 'inlineCode')
		.map((n) => ({ start: n.start, end: n.end }));

	const found: InlineNode[] = [];

	let pos = start;
	for (const occ of occupied) {
		scanRegionForLinksAndAutolinks(raw, pos, occ.start, found);
		pos = occ.end;
	}
	scanRegionForLinksAndAutolinks(raw, pos, end, found);

	if (found.length === 0) return codeSpans;

	// Merge code spans and found nodes, sorted by start position
	const allOccupied: InlineNode[] = [
		...codeSpans.filter((n) => n.kind === 'inlineCode'),
		...found
	].sort((a, b) => a.start - b.start);

	// Rebuild the node list: text gaps + occupied nodes
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

/**
 * Attempt to parse a link/image destination `(url "title")` starting at pos.
 * pos must point at the `(` character.
 * Returns { url, title, end } on success (end is past the closing `)`), or null.
 */
function parseDestination(
	raw: string,
	pos: number,
	limit: number
): { url: string; title: string | undefined; end: number } | null {
	if (pos >= limit || raw[pos] !== '(') return null;
	pos++; // consume '('

	// Skip optional leading whitespace
	while (pos < limit && (raw[pos] === ' ' || raw[pos] === '\t')) pos++;

	// Read URL — stop at whitespace, '"', "'", ')', or '<'
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

	// Skip whitespace between url and optional title
	while (pos < limit && (raw[pos] === ' ' || raw[pos] === '\t')) pos++;

	// Optional title: "..." or '...'
	let title: string | undefined;
	if (pos < limit && (raw[pos] === '"' || raw[pos] === "'")) {
		const quote = raw[pos];
		pos++; // consume opening quote
		const titleStart = pos;
		while (pos < limit && raw[pos] !== quote) pos++;
		if (pos >= limit) return null; // unterminated title
		title = raw.slice(titleStart, pos);
		pos++; // consume closing quote
	}

	// Skip trailing whitespace
	while (pos < limit && (raw[pos] === ' ' || raw[pos] === '\t')) pos++;

	if (pos >= limit || raw[pos] !== ')') return null;
	pos++; // consume ')'

	return { url, title, end: pos };
}

/**
 * Scan a single unoccupied text region for link, image, and autolink patterns.
 * Appends any found nodes to `out`.
 */
function scanRegionForLinksAndAutolinks(
	raw: string,
	start: number,
	end: number,
	out: InlineNode[]
): void {
	let pos = start;

	while (pos < end) {
		const ch = raw[pos];

		// Check for image: ![
		if (ch === '!' && pos + 1 < end && raw[pos + 1] === '[') {
			const bracketOpen = pos + 1;
			const bracketClose = findMatchingBracket(raw, bracketOpen, end);
			if (bracketClose !== -1) {
				const dest = parseDestination(raw, bracketClose + 1, end);
				if (dest !== null) {
					const alt = raw.slice(bracketOpen + 1, bracketClose);
					out.push({
						kind: 'image',
						start: pos,
						end: dest.end,
						alt,
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

		// Check for link: [
		if (ch === '[') {
			const bracketClose = findMatchingBracket(raw, pos, end);
			if (bracketClose !== -1) {
				const dest = parseDestination(raw, bracketClose + 1, end);
				if (dest !== null) {
					// Recursively parse the link text for emphasis etc.
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

		// Check for angle-bracket autolink: <https://...> or <http://...>
		if (ch === '<') {
			const closeAngle = raw.indexOf('>', pos + 1);
			if (closeAngle !== -1 && closeAngle < end) {
				const inner = raw.slice(pos + 1, closeAngle);
				if (/^https?:\/\/\S+$/.test(inner)) {
					out.push({
						kind: 'autolink',
						start: pos,
						end: closeAngle + 1,
						url: inner
					});
					pos = closeAngle + 1;
					continue;
				}
			}
			pos++;
			continue;
		}

		// Check for bare URL autolink: https:// or http://
		if (ch === 'h' || ch === 'H') {
			const lower = raw.slice(pos, pos + 8).toLowerCase();
			const schemeLen = lower.startsWith('https://') ? 8 : lower.startsWith('http://') ? 7 : 0;
			if (schemeLen > 0) {
				let urlEnd = pos + schemeLen;
				while (urlEnd < end && !/\s/.test(raw[urlEnd])) urlEnd++;
				if (urlEnd > pos + schemeLen) {
					const url = raw.slice(pos, urlEnd);
					out.push({
						kind: 'autolink',
						start: pos,
						end: urlEnd,
						url
					});
					pos = urlEnd;
					continue;
				}
			}
		}

		pos++;
	}
}

/**
 * Find the matching `]` for the `[` at bracketStart. Handles nested brackets.
 */
function findMatchingBracket(raw: string, bracketStart: number, limit: number): number {
	let depth = 0;
	let pos = bracketStart;
	while (pos < limit) {
		if (raw[pos] === '[') depth++;
		else if (raw[pos] === ']') {
			depth--;
			if (depth === 0) return pos;
		}
		pos++;
	}
	return -1;
}
