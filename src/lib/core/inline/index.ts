/**
 * Inline parser orchestrator for CST Phase 2.
 * See docs/design/editor/inline-parsing.md for the design spec.
 *
 * Pipeline:
 *   Stage 1    — backticks.ts         (scanBacktickSpans)
 *   Stage 1.5  — links.ts             (scanLinksAndAutolinks)
 *   Stages 2+3 — emphasis.ts          (buildSegments + processEmphasis)
 *   Post       — post-process.ts      (hard breaks + merge adjacent text)
 */

import type { CstNode, InlineNode } from '../nodes';
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

	// Inlined displayLength (trailing line-ending strip). core/text-utils.ts
	// moves to raw-text.ts at the editor root in Task 7; inlining here keeps
	// the core/ layer from importing upward into the editor layer.
	const displayEnd = raw.endsWith('\r\n')
		? raw.length - 2
		: raw.endsWith('\n')
			? raw.length - 1
			: raw.length;

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

/** Returns true if the given block kind carries inline content (paragraph, heading, setextHeading). */
export function isProseKind(kind: string): boolean {
	return kind === 'paragraph' || kind === 'heading' || kind === 'setextHeading';
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
