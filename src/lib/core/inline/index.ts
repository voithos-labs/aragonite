/**
 * Inline parser entry. See docs/design/inline-parsing.md.
 */

import type { CstNode, InlineNode } from '../nodes';
import type { NodeView } from '../node-views';
import { displayLength } from '../lines';
import { getBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import type { LinkReferenceResolver } from './link-reference-resolver';
import { scanInline } from './scan';
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
export function getContentRange(node: NodeView): ContentRange {
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
	node: NodeView,
	resolver?: LinkReferenceResolver
): InlineNode[] {
	recordInlineCompute();
	const range = getContentRange(node);
	return parseInline(node.raw, range.start, range.end, resolver);
}

// ── Inline Parser ──────────────────────────────────────────────────────────

/**
 * Parse inline content over raw[start, end): a single-pass character-dispatch
 * scan with delimiter and bracket stacks (scan/). Returned node offsets are
 * absolute into raw; every byte lands in exactly one node's range.
 */
export const parseInline = scanInline;
