/**
 * Inline pipeline stage 1.5: link, image, and autolink scanning over the text
 * regions left by earlier pre-passes (backticks, escapes, entity references).
 *
 * The links.ts ↔ index.ts module cycle is benign: parseInline is called at
 * runtime, not module-init.
 */

import type { InlineNode } from '../nodes';
import { parseInline } from './index';

export function scanLinksAndAutolinks(
	raw: string,
	start: number,
	end: number,
	occupied: InlineNode[]
): InlineNode[] {
	const occupiedRanges: Array<{ start: number; end: number }> = occupied
		.filter((n) => n.kind !== 'text')
		.map((n) => ({ start: n.start, end: n.end }));

	const found: InlineNode[] = [];

	let pos = start;
	for (const range of occupiedRanges) {
		scanRegionForLinksAndAutolinks(raw, pos, range.start, found);
		pos = range.end;
	}
	scanRegionForLinksAndAutolinks(raw, pos, end, found);

	if (found.length === 0) return occupied;

	const allOccupied: InlineNode[] = [
		...occupied.filter((n) => n.kind !== 'text'),
		...found
	].sort((a, b) => a.start - b.start);

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

function scanRegionForLinksAndAutolinks(
	raw: string,
	start: number,
	end: number,
	out: InlineNode[]
): void {
	let pos = start;

	while (pos < end) {
		const ch = raw[pos];

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

		if (ch === '[') {
			const bracketClose = findMatchingBracket(raw, pos, end);
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
