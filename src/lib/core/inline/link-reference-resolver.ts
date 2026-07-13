/**
 * CommonMark §4.7 link-label normalization plus the document-level
 * resolver built from `linkReferenceDefinition` nodes.
 */

import type { CstNode } from '../nodes';
import { metadataOf } from '../nodes';

/**
 * Normalize a link label per CommonMark §4.7:
 * strip leading/trailing whitespace, collapse internal whitespace runs to
 * a single space, lowercase. BMP-only — full Unicode case-fold deferred
 * until reported.
 */
export function normalizeLinkLabel(raw: string): string {
	return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

export type ResolvedReference = Readonly<{ url: string; title?: string }>;
export type LinkReferenceResolver = (label: string) => ResolvedReference | undefined;

export interface LinkReferenceMap {
	/** Look up a (non-normalized) label and return the resolved reference, or undefined. */
	resolve: LinkReferenceResolver;
	/**
	 * Stable string snapshot of the LRD set (sorted `label<:>url<:>title`
	 * join). The block render path folds this into its render-memo key for
	 * reference-bearing blocks, and the lazy inline cache validates on it, so an
	 * LRD change elsewhere re-renders and re-resolves them.
	 */
	readonly signature: string;
}

/**
 * Build a label→{url, title} map from every `linkReferenceDefinition` node in the
 * document tree — nested inside any container included. First-wins on duplicate
 * normalized labels (CommonMark §4.7).
 */
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
	for (const node of nodes) {
		if (node.kind === 'linkReferenceDefinition') {
			const meta = metadataOf(node, 'linkReferenceDefinition');
			if (meta?.label === undefined || meta.url === undefined) continue;
			const key = normalizeLinkLabel(meta.label);
			if (entries.has(key)) continue; // first-wins
			const entry: ResolvedReference =
				meta.title !== undefined
					? Object.freeze({ url: meta.url, title: meta.title })
					: Object.freeze({ url: meta.url });
			entries.set(key, entry);
		}
		if (node.children) {
			collectLinkReferences(node.children, entries);
		}
	}
}
