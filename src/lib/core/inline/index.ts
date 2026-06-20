/**
 * Inline parser orchestrator. See docs/design/editor/inline-parsing.md.
 */

import type { CstNode, InlineNode } from '../nodes';
import { displayLength } from '../lines';
import { getBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { scanBacktickSpans } from './backticks';
import { scanEscapes } from './escapes';
import { scanCharacterReferences } from './character-refs';
import { scanLinksAndAutolinks } from './links';
import type { LinkReferenceResolver } from './link-reference-resolver';
import { scanInlineRawHtml } from './raw-html';
import { buildSegments, processEmphasis, hasDelimiterChars } from './emphasis';
import { processHardLineBreaks, mergeAdjacentText } from './post-process';
import { recordInlineCompute } from '../../perf/instruments';

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
 * Compute a prose node's inline tree from its raw. Pure — no caching, no
 * reactive reads. The render path calls this directly; the caching accessor
 * (inline-cache.ts) calls it on a miss.
 */
export function computeInlineContent(
	node: CstNode,
	resolver?: LinkReferenceResolver
): InlineNode[] {
	recordInlineCompute();
	const range = getContentRange(node);
	return parseInline(node.raw, range.start, range.end, resolver);
}

/**
 * Prose-node count of an inline-sweep target set. Lives here rather than in
 * perf/instruments because isProseKind reads the schema registry and
 * instruments must stay a leaf module.
 */
export function countProseNodes(nodes: CstNode[]): number {
	let count = 0;
	for (const node of nodes) {
		if (isProseKind(node.kind)) count++;
		if (node.children) count += countProseNodes(node.children);
	}
	return count;
}

/**
 * Refresh `inlineContent` on every prose node under `nodes`. The editor shell
 * is the sole production caller — operations rely on it instead of
 * pre-populating the cache themselves.
 */
export function parseAllInlineContent(nodes: CstNode[], resolver?: LinkReferenceResolver): void {
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
 * Parse inline content over raw[start, end). Returned node offsets are
 * absolute into raw. Stage order matters: backticks run first so escapes and
 * entities skip code-span content; both pre-passes precede emphasis so
 * neutralized delimiters do not pair.
 */
export function parseInline(
	raw: string,
	start: number,
	end: number,
	resolver?: LinkReferenceResolver
): InlineNode[] {
	const codeSpans = scanBacktickSpans(raw, start, end);
	const withEscapes = scanEscapes(raw, start, end, codeSpans);
	const withEntities = scanCharacterReferences(raw, start, end, withEscapes);
	const withLinks = scanLinksAndAutolinks(raw, start, end, withEntities, resolver);
	const withRawHtml = scanInlineRawHtml(raw, start, end, withLinks);

	if (!hasDelimiterChars(raw, start, end, withRawHtml)) {
		return processHardLineBreaks(mergeAdjacentText(withRawHtml), raw);
	}

	const segments = buildSegments(raw, start, end, withRawHtml);
	const emphasized = processEmphasis(raw, segments);
	const merged = mergeAdjacentText(emphasized);
	return processHardLineBreaks(merged, raw);
}
