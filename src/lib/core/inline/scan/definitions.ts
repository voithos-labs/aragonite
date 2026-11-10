// The link reference definitions a document holds, read out of its block tree, nested ones too.
import { metadataOf } from '../../nodes';
import type { NodeView } from '../../node-views';
import { labelKey } from './link-grammar';

export type ResolvedReference = Readonly<{ url: string; title?: string }>;
/** Takes a label as written; matching follows `labelKey`. */
export type LinkReferenceResolver = (label: string) => ResolvedReference | undefined;

export interface LinkDefinitions {
	resolve: LinkReferenceResolver;
	/** Changes exactly when the definition set does; empty for none. It can reach megabytes. */
	readonly signature: string;
}

/** A label's first definition wins (CommonMark §4.7). */
export function definitionsOf(blocks: readonly NodeView[]): LinkDefinitions {
	const found = new Map<string, ResolvedReference>();
	// Children are pushed in reverse so blocks pop in document order without recursion.
	const pending = [...blocks].reverse();
	for (let block = pending.pop(); block; block = pending.pop()) {
		if (block.kind === 'linkReferenceDefinition') {
			const meta = metadataOf(block, 'linkReferenceDefinition');
			const key = meta?.label === undefined ? undefined : labelKey(meta.label);
			if (key !== undefined && meta.url !== undefined && !found.has(key)) {
				const { url, title } = meta;
				found.set(key, Object.freeze(title === undefined ? { url } : { url, title }));
			}
		}
		const children = block.children ?? [];
		for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
	}
	const sorted = [...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return {
		resolve: (label) => found.get(labelKey(label)),
		signature: sorted.length === 0 ? '' : JSON.stringify(sorted)
	};
}
