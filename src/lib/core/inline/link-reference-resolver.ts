/** Link label matching (GFM §6.6) and the resolver built from a document's link reference
 *  definitions. */

import type { CstNode } from '../nodes';
import { metadataOf } from '../nodes';
import { trimWhitespace, WHITESPACE_RUN } from '../lines';

/** GFM §6.6 label normalization, lowercasing rather than full Unicode case folding. Whitespace
 *  is §2.1's ASCII set, so `[a<NBSP>b]` and `[a b]` are different labels. */
export function normalizeLinkLabel(raw: string): string {
	return trimWhitespace(raw).split(WHITESPACE_RUN).join(' ').toLowerCase();
}

export type ResolvedReference = Readonly<{ url: string; title?: string }>;
export type LinkReferenceResolver = (label: string) => ResolvedReference | undefined;

export interface LinkReferenceMap {
	/** Takes a non-normalized label. */
	resolve: LinkReferenceResolver;
	/**
	 * Stable snapshot of the definition set, which the lazy inline cache keys on. The render path
	 * keys on a small counter instead: this string reaches megabytes in reference-heavy documents.
	 */
	readonly signature: string;
}

/** Collects link reference definitions nested in containers too; a label's first definition
 *  wins (§4.7). */
export function buildLinkReferenceMap(nodes: CstNode[]): LinkReferenceMap {
	const entries = new Map<string, ResolvedReference>();
	collectLinkReferences(nodes, entries);

	const sigParts: string[] = [];
	for (const [label, ref] of entries) {
		sigParts.push(`${label}<:>${ref.url}<:>${ref.title ?? ''}`);
	}
	sigParts.sort();
	const signature = sigParts.join('|');

	return {
		resolve: (label) => entries.get(normalizeLinkLabel(label)),
		signature
	};
}

function collectLinkReferences(nodes: CstNode[], entries: Map<string, ResolvedReference>): void {
	const stack: CstNode[] = [];
	// Reversed push, so pop order is document order and the first definition wins.
	const push = (level: CstNode[]) => {
		for (let i = level.length - 1; i >= 0; i--) stack.push(level[i]);
	};
	push(nodes);
	while (stack.length > 0) {
		const node = stack.pop()!;
		if (node.kind === 'linkReferenceDefinition') {
			const meta = metadataOf(node, 'linkReferenceDefinition');
			if (meta?.label === undefined || meta.url === undefined) continue;
			const key = normalizeLinkLabel(meta.label);
			if (entries.has(key)) continue;
			entries.set(
				key,
				meta.title !== undefined
					? Object.freeze({ url: meta.url, title: meta.title })
					: Object.freeze({ url: meta.url })
			);
		}
		if (node.children) push(node.children);
	}
}
