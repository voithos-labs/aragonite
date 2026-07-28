/**
 * Lazy `inlineContent` accessor for non-render consumers, backed by a
 * node-keyed, non-reactive WeakMap. Non-reactive by design: never call from the
 * render path (which uses computeInlineContent) — a reactive read+write here
 * would re-introduce the keyed-`{#each}` corruption that invariant G4.2 guards
 * against.
 *
 * Each node holds one sub-entry per signature space so the resolver-less callers
 * and the signature-bearing callers stop evicting each other on a bracket-
 * bearing block: `plain` keys on raw alone (signature ''), `resolved` keys on
 * raw plus the live LRD signature. A raw change invalidates each side through
 * its own raw check. Memory: up to two content arrays per node, and the second
 * only for a bracket block actually read through both signature spaces.
 */
import type { InlineNode } from '../nodes';
import type { NodeView } from '../node-views';
import type { LinkReferenceResolver } from './link-reference-resolver';
import { computeInlineContent, isProseKind } from './index';

interface CacheEntry {
	plain?: { raw: string; content: InlineNode[] };
	resolved?: { raw: string; signature: string; content: InlineNode[] };
}

const cache = new WeakMap<NodeView, CacheEntry>();

export function getInlineContent(
	node: NodeView,
	resolver?: LinkReferenceResolver,
	signature = ''
): InlineNode[] {
	if (!isProseKind(node.kind)) return [];
	// A block resolves through an LRD only if it contains a bracket — mirror the
	// render gate so a bracketless block neither passes the resolver nor keys on
	// the signature.
	const hasRef = node.raw.includes('[');
	const sig = hasRef ? signature : '';
	const effectiveResolver = hasRef ? resolver : undefined;
	const entry = cache.get(node);

	if (sig === '') {
		const hit = entry?.plain;
		if (hit && hit.raw === node.raw) return hit.content;
		const content = computeInlineContent(node, effectiveResolver);
		cache.set(node, { plain: { raw: node.raw, content }, resolved: entry?.resolved });
		return content;
	}

	const hit = entry?.resolved;
	if (hit && hit.raw === node.raw && hit.signature === sig) return hit.content;
	const content = computeInlineContent(node, effectiveResolver);
	cache.set(node, { plain: entry?.plain, resolved: { raw: node.raw, signature: sig, content } });
	return content;
}

/**
 * Resolver-aware inline read for the non-render text-surface consumers (widget
 * interaction, edge dispatch, construct reveal, clipboard): the one spelling of
 * `getInlineContent(node, ref.current, ref.signature)` so a call site can't drop
 * the signature and silently desync widget detection from what render drew.
 *
 * The `linkRef` shape matches editor-keys' `LinkReferenceResolverRef`, but is kept
 * structural: naming it would pull `core/inline` onto `editor-keys`, which already
 * imports back into this layer.
 */
export function resolvedInlineContent(
	node: NodeView,
	linkRef?: { current?: LinkReferenceResolver; signature?: string }
): InlineNode[] {
	return getInlineContent(node, linkRef?.current, linkRef?.signature ?? '');
}
