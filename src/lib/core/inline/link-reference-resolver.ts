/** CommonMark §4.7 label normalization plus the resolver built from LRD nodes. */

import type { CstNode } from '../nodes';
import { metadataOf } from '../nodes';

/** CommonMark §4.7 normalization. BMP-only: full Unicode case-fold is deferred until reported. */
export function normalizeLinkLabel(raw: string): string {
	return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

export type ResolvedReference = Readonly<{ url: string; title?: string }>;
export type LinkReferenceResolver = (label: string) => ResolvedReference | undefined;

export interface LinkReferenceMap {
	/** Takes a non-normalized label. */
	resolve: LinkReferenceResolver;
	/**
	 * Stable snapshot of the LRD set. The lazy inline cache validates reference-bearing blocks
	 * on it, so an LRD change elsewhere re-resolves them. The render path keys on a compact
	 * epoch instead, never this string: it reaches ~MB scale in reference-heavy documents.
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
