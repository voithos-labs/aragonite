// Hand-built containers rebuilt through their kind's descriptor, and a one-child rewrite that hands
// the rebuild its hint the way the typing path does.

import { makeBlockNode, type BlockMetadata, type CstNode } from '#lib/core/nodes.js';
import { writeContainerRaw } from '#lib/schema/container-writer.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';

export const paragraph = (raw: string, leadingTrivia = ''): CstNode =>
	makeBlockNode({ kind: 'paragraph', leadingTrivia, raw });

export const listItemMeta = (marker: string, taskMarker: string | null = null): BlockMetadata => ({
	marker,
	taskItem: taskMarker !== null,
	taskChecked: false,
	taskMarker
});

export function container(
	kind: 'list' | 'listItem' | 'blockquote',
	children: CstNode[],
	extra: { metadata?: BlockMetadata; innerSuffix?: string } = {}
): CstNode {
	const node = makeBlockNode({
		kind,
		leadingTrivia: '',
		raw: '',
		metadata: extra.metadata ?? (kind === 'list' ? { ordered: false } : { quoteDepth: 1 }),
		children,
		innerSuffix: extra.innerSuffix
	});
	rebuild(node);
	return node;
}

export function rebuild(node: CstNode, changed?: { index: number; previousRaw: string }): void {
	writeContainerRaw(node, defaultGrammarView, changed);
}

export function rewriteChild(node: CstNode, index: number, raw: string): void {
	const previousRaw = node.children![index].raw;
	node.children![index].raw = raw;
	rebuild(node, { index, previousRaw });
}

export const spans = (node: CstNode): number[] | undefined =>
	node.childSpans ? Array.from(node.childSpans) : undefined;
