/**
 * Lazy `inlineContent` accessor for non-render consumers, over a node-keyed WeakMap.
 * Non-reactive by design: never call from the render path (which uses computeInlineContent),
 * since a reactive read+write here re-introduces the keyed-`{#each}` corruption G4.2 guards.
 * One sub-entry per signature space, so resolver-less and signature-bearing callers cannot
 * evict each other on a bracket-bearing block.
 */
import type { InlineNode } from '../nodes';
import type { NodeView } from '../node-views';
import type { LinkReferenceResolver } from './link-reference-resolver';
import { computeInlineContent, isProseKind } from './index';

interface CacheSlot {
	raw: string;
	signature: string;
	content: InlineNode[];
}

interface CacheEntry {
	plain?: CacheSlot;
	resolved?: CacheSlot;
}

const cache = new WeakMap<NodeView, CacheEntry>();

export function getInlineContent(
	node: NodeView,
	resolver?: LinkReferenceResolver,
	signature = ''
): InlineNode[] {
	if (!isProseKind(node.kind)) return [];
	// A block resolves through an LRD only if it holds a bracket; mirroring the render gate keeps
	// a bracketless block off both the resolver and the signature.
	const hasRef = node.raw.includes('[');
	const sig = hasRef ? signature : '';
	const effectiveResolver = hasRef ? resolver : undefined;
	const entry = cache.get(node);

	const slot = sig === '' ? 'plain' : 'resolved';
	const hit = entry?.[slot];
	if (hit && hit.raw === node.raw && hit.signature === sig) return hit.content;
	const content = computeInlineContent(node, effectiveResolver);
	// Spread, so refilling one slot carries the other one through untouched.
	cache.set(node, { ...entry, [slot]: { raw: node.raw, signature: sig, content } });
	return content;
}

/**
 * The one spelling of `getInlineContent(node, ref.current, ref.signature)`, so a non-render
 * call site cannot drop the signature and silently desync from what render drew. `linkRef`
 * stays structural: naming editor-keys' type would cycle that module back onto this layer.
 */
export function resolvedInlineContent(
	node: NodeView,
	linkRef?: { current?: LinkReferenceResolver; signature?: string }
): InlineNode[] {
	return getInlineContent(node, linkRef?.current, linkRef?.signature ?? '');
}
