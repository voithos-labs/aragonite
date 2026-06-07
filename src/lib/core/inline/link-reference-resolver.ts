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
	 * Stable string snapshot of the LRD set. Diagnostic field — the editor
	 * shell does not gate re-parse on it (action-site `parseAllInlineContent`
	 * call sites bypass the resolver, so the shell unconditionally re-parses
	 * on every commit). Useful for tests and future external consumers that
	 * want change-detection on the LRD set.
	 */
	readonly signature: string;
}

/**
 * Build a label→{url, title} map from all `linkReferenceDefinition` nodes in
 * the document tree. Walks recursively into container kinds (blockquote, list,
 * listItem). First-wins on duplicate normalized labels (CommonMark §4.7).
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
