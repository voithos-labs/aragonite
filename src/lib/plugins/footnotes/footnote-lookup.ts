/**
 * Where a `[^label]` reference jumps to: the caret landing inside that label's definition.
 * Depth-first in document order, so two definitions under one label resolve to the first,
 * which is the one GFM renders.
 */

import { getPluginMetadata, type DocumentView, type NodeView } from '$lib/plugin';
import { FOOTNOTE_DEF_KIND } from './constants';
import type { FootnoteDefMetadata } from './footnote-definition';

interface DefinitionMatch {
	node: NodeView;
	path: number[];
}

function findInSubtree(node: NodeView, path: number[], label: string): DefinitionMatch | null {
	if (
		node.kind === FOOTNOTE_DEF_KIND &&
		getPluginMetadata<FootnoteDefMetadata>(node)?.label === label
	) {
		return { node, path };
	}
	const children = node.children;
	if (!children) return null;
	for (let index = 0; index < children.length; index++) {
		const hit = findInSubtree(children[index], [...path, index], label);
		if (hit) return hit;
	}
	return null;
}

/** The definition's first body block, since the container itself is no caret seat. The
 *  container path stands in when the body holds no block; null when no definition matches. */
export function findFootnoteDefinitionLanding(
	document: DocumentView,
	label: string
): number[] | null {
	const children = document.children;
	for (let index = 0; index < children.length; index++) {
		const match = findInSubtree(children[index], [index], label);
		if (match) return match.node.children?.length ? [...match.path, 0] : match.path;
	}
	return null;
}
