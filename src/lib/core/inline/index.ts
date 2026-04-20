/**
 * Inline parser orchestrator for CST Phase 2.
 * See docs/design/editor/inline-parsing.md for the design spec.
 */

import type { CstNode, InlineNode } from '../nodes';
import { displayLength } from '../lines';
import { getBlockKindDescriptor } from '../../tree-operations/block-kind-descriptor';
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
 * Extract the content range within a prose block's raw text. Delegates to the
 * block-kind descriptor's `getContentRange` hook when present; paragraphs and
 * other no-marker prose kinds use the default (start=0, end=displayLength).
 */
export function getContentRange(node: CstNode): ContentRange {
	const d = getBlockKindDescriptor(node.kind);
	if (d.getContentRange) return d.getContentRange(node);
	return { start: 0, end: displayLength(node.raw) };
}

export function isProseKind(kind: CstNode['kind']): boolean {
	return getBlockKindDescriptor(kind).supportsInline;
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
