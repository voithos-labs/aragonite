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
import type { GrammarView } from '../../schema/block-openers';
import type { Reading } from '../../schema/reading';
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

/** The parts of an editor's reading its inline parse needs. */
export type InlineReading = Pick<Reading, 'grammar' | 'resolver' | 'resolverSignature'>;

/**
 * The one spelling of `getInlineContent` over the editor's reading, so a non-render call site
 * cannot drop the signature or the grammar and desync from what render drew.
 */
export function resolvedInlineContent(node: NodeView, reading: InlineReading): InlineNode[] {
	return getInlineContent(node, reading.resolver, reading.resolverSignature, reading.grammar);
}
