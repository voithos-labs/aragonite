/** CommonMark §4.7 label normalization plus the resolver built from LRD nodes. */

import type { CstNode } from '../nodes';
import { metadataOf } from '../nodes';

/** CommonMark §4.7 normalization, lowercasing rather than full Unicode case folding. */
export function normalizeLinkLabel(raw: string): string {
	return raw.trim().replace(/\s+/g, ' ').toLowerCase();
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

/** Collects LRDs nested inside containers too. First-wins on duplicate labels (§4.7). */
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
	// Reversed push, so pop order is document order — which is what first-wins reads.
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
			if (entries.has(key)) continue; // first-wins
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
