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
import { preEscapeInline } from './pre-escape';

// ── Reference resolver (reserved for 0.6.6) ────────────────────────────────

/**
 * Resolves a link reference label to a destination URL and optional title.
 * Returns null when the label has no matching `linkReferenceDefinition` in
 * the document. Passed through `parseInline` / `parseAllInlineContent` so
 * 0.6.6 can populate reference-style link/image destinations at parse time.
 *
 * The parameter is optional at 0.5.5.4 — no caller populates it and the
 * parser ignores it. Adding the seat now means 0.6.6 does not need to
 * change every parse callsite when it lands.
 */
export type RefResolver = (label: string) => { url: string; title?: string } | null;

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
export function parseAllInlineContent(nodes: CstNode[], resolver?: RefResolver): void {
	for (const node of nodes) {
		if (isProseKind(node.kind)) {
			const range = getContentRange(node);
			node.inlineContent = parseInline(node.raw, range.start, range.end, resolver);
		}
		if (node.children) {
			parseAllInlineContent(node.children, resolver);
		}
	}
}

// ── Inline Parser ──────────────────────────────────────────────────────────

/**
 * Parse inline content within a prose block's raw text.
 * Returns an InlineNode[] tree covering the range [start, end) in raw.
 * All start/end offsets in returned nodes are relative to the full raw string.
 */
export function parseInline(
	raw: string,
	start: number,
	end: number,
	resolver?: RefResolver
): InlineNode[] {
	// resolver threads through to scanLinksAndAutolinks (and its internal parseInline
	// recursion for link text). No caller populates it at 0.5.5.4 — it becomes live
	// at 0.6.6 (reference-style link/image resolution).

	// Stage 0: pre-escape normalization. Identity today; 0.6.2 fills this in.
	preEscapeInline(raw, start, end);

	const codeSpans = scanBacktickSpans(raw, start, end);
	const withLinks = scanLinksAndAutolinks(raw, start, end, codeSpans, resolver);

	if (!hasDelimiterChars(raw, start, end, withLinks)) {
		return processHardLineBreaks(withLinks, raw);
	}

	const segments = buildSegments(raw, start, end, withLinks);
	const emphasized = processEmphasis(raw, segments);
	const merged = mergeAdjacentText(emphasized);
	return processHardLineBreaks(merged, raw);
}
