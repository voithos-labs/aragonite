/**
 * How a block reads on the page, the one answer the drag handle, the context menu and the drag
 * ghost ask: the kind's declared `pageRole`, except that a paragraph holding only pictures is an
 * object whatever its kind declares.
 */

import type { NodeView } from '../core/node-views';
import { isImageOnlyParagraph } from '../core/inline/picture';
import type { InlineReading } from '../core/inline/inline-cache';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';

export type PageRole = 'prose' | 'object';

export function blockPageRole(node: NodeView, reading: InlineReading): PageRole {
	if (isImageOnlyParagraph(node, reading)) return 'object';
	return tryGetBlockKindDescriptor(node.kind)?.pageRole ?? 'object';
}

/**
 * Prose the caret writes in: a prose block holding no children. A right-click there acts on the
 * text; a prose container's own frame (a quote's bar) is aimed at the container instead.
 */
export function isProseLeaf(node: NodeView, reading: InlineReading): boolean {
	return (
		blockPageRole(node, reading) === 'prose' && !tryGetBlockKindDescriptor(node.kind)?.isContainer
	);
}
