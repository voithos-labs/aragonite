/**
 * Inline parser for prose block content (CST Phase 2).
 * Produces InlineNode trees from the content portion of raw text.
 * See docs/editor/inline-parsing-design.md for the design spec.
 */

import type { CstNode, InlineNode } from './nodes';

// ── Content Range ──────────────────────────────────────────────────────────

export interface ContentRange {
	start: number;
	end: number;
}

/**
 * Extract the content range within a prose block's raw text.
 * Returns start/end offsets that exclude block-level markers and trailing line endings.
 */
export function getContentRange(node: CstNode): ContentRange {
	const raw = node.raw;

	if (node.kind === 'heading') {
		let i = 0;
		while (i < raw.length && raw[i] === ' ') i++;
		while (i < raw.length && raw[i] === '#') i++;
		if (i < raw.length && raw[i] === ' ') i++;
		return { start: i, end: trimTrailingLineEnding(raw) };
	}

	if (node.kind === 'setextHeading') {
		const end = trimTrailingLineEnding(raw);
		let underlineStart = raw.lastIndexOf('\n', end - 1);
		if (underlineStart === -1) return { start: 0, end };
		let contentEnd = underlineStart;
		if (contentEnd > 0 && raw[contentEnd - 1] === '\r') contentEnd--;
		return { start: 0, end: contentEnd };
	}

	// paragraph and other prose blocks
	return { start: 0, end: trimTrailingLineEnding(raw) };
}

function trimTrailingLineEnding(raw: string): number {
	let end = raw.length;
	if (raw.endsWith('\r\n')) end -= 2;
	else if (raw.endsWith('\n')) end -= 1;
	return end;
}

// ── Inline Parser ──────────────────────────────────────────────────────────

/**
 * Parse inline content within a prose block's raw text.
 * Returns an InlineNode[] tree covering the range [start, end) in raw.
 * All start/end offsets in returned nodes are relative to the full raw string.
 */
export function parseInline(raw: string, start: number, end: number): InlineNode[] {
	return scanBacktickSpans(raw, start, end);
}

// ── Backtick Scanning (Stage 1) ────────────────────────────────────────────

function scanBacktickSpans(raw: string, start: number, end: number): InlineNode[] {
	const nodes: InlineNode[] = [];
	let pos = start;
	let textStart = start;

	while (pos < end) {
		if (raw[pos] === '`') {
			const tickStart = pos;
			while (pos < end && raw[pos] === '`') pos++;
			const tickLen = pos - tickStart;

			// Search for matching closing backtick sequence
			let closeStart = -1;
			let searchPos = pos;
			while (searchPos < end) {
				if (raw[searchPos] === '`') {
					const cStart = searchPos;
					while (searchPos < end && raw[searchPos] === '`') searchPos++;
					if (searchPos - cStart === tickLen) {
						closeStart = cStart;
						break;
					}
				} else {
					searchPos++;
				}
			}

			if (closeStart !== -1) {
				if (textStart < tickStart) {
					nodes.push({
						kind: 'text',
						start: textStart,
						end: tickStart,
						text: raw.slice(textStart, tickStart)
					});
				}

				const contentStart = tickStart + tickLen;
				const contentEnd = closeStart;
				nodes.push({
					kind: 'inlineCode',
					start: tickStart,
					end: closeStart + tickLen,
					text: raw.slice(contentStart, contentEnd)
				});

				textStart = closeStart + tickLen;
				pos = textStart;
			}
		} else {
			pos++;
		}
	}

	if (textStart < end) {
		nodes.push({
			kind: 'text',
			start: textStart,
			end: end,
			text: raw.slice(textStart, end)
		});
	}

	return nodes;
}
