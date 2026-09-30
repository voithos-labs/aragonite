/**
 * Where a `[^label]` reference jumps to: the block inside that label's definition.
 * Depth-first in document order, so two definitions under one label resolve to the first,
 * which is the one GFM renders.
 */

import { getPluginMetadata, walkBlocks, type DocumentView } from '$lib/plugin';
import { FOOTNOTE_DEF_KIND } from './constants';
import type { FootnoteDefMetadata } from './footnote-definition';

/** The definition's first body block, since the caret cannot sit on the container itself. The
 *  container's own path is used when the body holds no block; null when no definition matches. */
export function findFootnoteDefinitionLanding(
	document: DocumentView,
	label: string
): number[] | null {
	let landing: number[] | null = null;
	walkBlocks(document, (node, path) => {
		if (node.kind !== FOOTNOTE_DEF_KIND) return;
		if (getPluginMetadata<FootnoteDefMetadata>(node)?.label !== label) return;
		landing = node.children?.length ? [...path, 0] : path;
		return 'stop';
	});
	return landing;
}
