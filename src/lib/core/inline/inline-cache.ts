/**
 * Lazy `inlineContent` accessor for non-render consumers, over a node-keyed WeakMap.
 * Non-reactive by design: never call from the render path (which uses computeInlineContent),
 * since a reactive read plus write here corrupts a keyed `{#each}` (G4.2).
 * One sub-entry per signature space, so resolver-less and signature-bearing callers cannot
 * evict each other on a bracket-bearing block. A slot answers only the grammar it was parsed in.
 */
import type { InlineNode } from '../nodes';
import type { NodeView } from '../node-views';
import type { LinkReferenceResolver } from './link-reference-resolver';
import { defaultGrammarView, type GrammarView } from '../../schema/block-openers';
import { computeInlineContent, isProseKind } from './index';

interface CacheSlot {
	raw: string;
	signature: string;
	grammar: GrammarView;
	content: InlineNode[];
}

interface CacheEntry {
	plain?: CacheSlot;
	resolved?: CacheSlot;
}

const cache = new WeakMap<NodeView, CacheEntry>();

export function getInlineContent(
	node: NodeView,
	resolver: LinkReferenceResolver | undefined,
	signature = '',
	grammar: GrammarView
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
	if (hit && hit.raw === node.raw && hit.signature === sig && hit.grammar === grammar) {
		return hit.content;
	}
	const content = computeInlineContent(node, effectiveResolver, grammar);
	// Spread, so refilling one slot keeps the other one untouched.
	cache.set(node, { ...entry, [slot]: { raw: node.raw, signature: sig, grammar, content } });
	return content;
}

/**
 * The one spelling of `getInlineContent(node, ref.current, ref.signature, ref.grammar)`, so a
 * non-render call site cannot drop the signature or the grammar and silently desync from what
 * render drew. With no `linkRef`, or no grammar on it, it reads every installed plugin. `linkRef`
 * stays structural: naming editor-keys' type would create an import cycle.
 */
export function resolvedInlineContent(
	node: NodeView,
	linkRef?: { current?: LinkReferenceResolver; signature?: string; grammar?: GrammarView }
): InlineNode[] {
	return getInlineContent(
		node,
		linkRef?.current,
		linkRef?.signature ?? '',
		linkRef?.grammar ?? defaultGrammarView
	);
}
