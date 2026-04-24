/**
 * Inline parser orchestrator. See docs/design/editor/inline-parsing.md.
 */

import type { CstNode, InlineNode } from '../nodes';
import { displayLength } from '../lines';
import { getBlockKindDescriptor } from '../../schema/block-kind-descriptor';
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
 * Content range within a prose block's raw. Defaults to the full display
 * range; block kinds with markers (e.g. headings) override via descriptor.
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
 * Refresh `inlineContent` on every prose node in the tree. Used after
 * structural mutations that bypass the per-input reactive pipeline.
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
 * Parse inline content over raw[start, end). Returned node offsets are
 * absolute into raw.
 */
export function parseInline(
	raw: string,
	start: number,
	end: number
): InlineNode[] {
	const codeSpans = scanBacktickSpans(raw, start, end);
	const withLinks = scanLinksAndAutolinks(raw, start, end, codeSpans);

	if (!hasDelimiterChars(raw, start, end, withLinks)) {
		return processHardLineBreaks(mergeAdjacentText(withLinks), raw);
	}

	const segments = buildSegments(raw, start, end, withLinks);
	const emphasized = processEmphasis(raw, segments);
	const merged = mergeAdjacentText(emphasized);
	return processHardLineBreaks(merged, raw);
}
