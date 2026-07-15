/**
 * Lazy `inlineContent` accessor for non-render consumers, backed by a
 * node-keyed, non-reactive WeakMap keyed on (raw, LRD-signature). Non-reactive
 * by design: never call from the render path (which uses computeInlineContent) —
 * a reactive read+write here would re-introduce the keyed-`{#each}` corruption
 * that invariant G4.2 guards against.
 */
import type { InlineNode } from '../nodes';
import type { NodeView } from '../node-views';
import type { LinkReferenceResolver } from './link-reference-resolver';
import { computeInlineContent, isProseKind } from './index';

interface CacheEntry {
	raw: string;
	signature: string;
	content: InlineNode[];
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
	const hit = cache.get(node);
	if (hit && hit.raw === node.raw && hit.signature === sig) return hit.content;
	const content = computeInlineContent(node, hasRef ? resolver : undefined);
	cache.set(node, { raw: node.raw, signature: sig, content });
	return content;
}
