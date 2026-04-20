/**
 * Inline parser orchestrator for CST Phase 2.
 * See docs/design/editor/inline-parsing.md for the design spec.
 */

import type { CstNode, InlineNode } from '../nodes';
import { displayLength } from '../lines';
import { scanBacktickSpans } from './backticks';
import { scanLinksAndAutolinks } from './links';
import { buildSegments, processEmphasis, hasDelimiterChars } from './emphasis';
import { processHardLineBreaks, mergeAdjacentText } from './post-process';

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
	const displayEnd = displayLength(raw);

	if (node.kind === 'heading') {
		let i = 0;
		while (i < raw.length && raw[i] === ' ') i++;
		while (i < raw.length && raw[i] === '#') i++;
		if (i < raw.length && raw[i] === ' ') i++;
		return { start: i, end: displayEnd };
	}

	if (node.kind === 'setextHeading') {
		const end = displayEnd;
		const underlineStart = raw.lastIndexOf('\n', end - 1);
		if (underlineStart === -1) return { start: 0, end };
		let contentEnd = underlineStart;
		if (contentEnd > 0 && raw[contentEnd - 1] === '\r') contentEnd--;
		return { start: 0, end: contentEnd };
	}

	// paragraph and other prose blocks
	return { start: 0, end: displayEnd };
}

export function isProseKind(kind: string): boolean {
	return kind === 'paragraph' || kind === 'heading' || kind === 'setextHeading';
}

/**
 * Refresh `inlineContent` on every prose node in the tree, recursing into
 * container children. Use after structural operations that produce or
 * mutate prose nodes outside the per-input reactive pipeline.
 */
export function parseAllInlineContent(nodes: CstNode[]): void {
	for (const node of nodes) {
		if (isProseKind(node.kind)) {
			const range = getContentRange(node);
			node.inlineContent = parseInline(node.raw, range.start, range.end);
		}
		if (node.children) {
			parseAllInlineContent(node.children);
		}
	}
}

// ── Inline Parser ──────────────────────────────────────────────────────────

/**
 * Parse inline content within a prose block's raw text.
 * Returns an InlineNode[] tree covering the range [start, end) in raw.
 * All start/end offsets in returned nodes are relative to the full raw string.
 */
export function parseInline(raw: string, start: number, end: number): InlineNode[] {
	const codeSpans = scanBacktickSpans(raw, start, end);
	const withLinks = scanLinksAndAutolinks(raw, start, end, codeSpans);

	if (!hasDelimiterChars(raw, start, end, withLinks)) {
		return processHardLineBreaks(withLinks, raw);
	}

	const segments = buildSegments(raw, start, end, withLinks);
	const emphasized = processEmphasis(raw, segments);
	const merged = mergeAdjacentText(emphasized);
	return processHardLineBreaks(merged, raw);
}
