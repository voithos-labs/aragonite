/**
 * Lazy `inlineContent` accessor for code outside the render path, over a node-keyed WeakMap.
 * Never call it from the render path, which computes from `node.raw` with `computeInlineContent` so a
 * render effect reads nothing else (G4.2). Resolver-less and resolving callers get
 * separate slots so they never evict each other, and a slot answers only its own grammar.
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
	// A block resolves a link reference definition only if it holds a bracket; the render path
	// checks the same, so a bracketless block skips both the resolver and the signature.
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
	cache.set(node, { ...entry, [slot]: { raw: node.raw, signature: sig, grammar, content } });
	return content;
}

/** The parts of an editor's reading its inline parse needs. */
export type InlineReading = Pick<Reading, 'grammar' | 'resolver' | 'resolverSignature'>;

/** Takes the whole reading, so a call site outside the render path cannot drop the signature or
 *  the grammar and disagree with what the render path drew. */
export function resolvedInlineContent(node: NodeView, reading: InlineReading): InlineNode[] {
	return getInlineContent(node, reading.resolver, reading.resolverSignature, reading.grammar);
}
