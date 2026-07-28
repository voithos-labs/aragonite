/**
 * Inline parser entry. See docs/design/inline-parsing.md.
 */

import type { CstNode, InlineNode } from '../nodes';
import type { NodeView } from '../node-views';
import { displayLength } from '../lines';
import { getBlockKindDescriptor } from '../../schema/block-kind-descriptor';
// Descriptor-read entry point (getContentRange/isProseKind): register the
// built-ins before any read, headless of the editor mount. Explicit call — a
// bare side-effect import is tree-shaken from the production build.
import { registerBuiltInDescriptors } from '../../schema/built-in-descriptors';
import type { LinkReferenceResolver } from './link-reference-resolver';
import { scanInline } from './scan';
import { recordInlineCompute } from '../../perf/instruments';

registerBuiltInDescriptors();

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
 *
 * Both bounds are checked, not just typed: a caller the compiler cannot reach
 * (plain JS, an `any`-typed site) that passes only the source would otherwise
 * compare against `undefined` throughout, skip the scan, and receive one text node
 * holding the whole string — wrong output that looks like a result.
 */
export function parseInline(
	raw: string,
	start: number,
	end: number,
	resolver?: LinkReferenceResolver
): InlineNode[] {
	if (!Number.isFinite(start) || !Number.isFinite(end)) {
		throw new TypeError(
			'parseInline requires both scan bounds — to scan a whole string, call parseInline(src, 0, src.length)'
		);
	}
	return scanInline(raw, start, end, resolver);
}
