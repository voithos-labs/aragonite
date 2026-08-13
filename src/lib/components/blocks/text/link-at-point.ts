/**
 * Which link construct a pointer landed in, and how to find that construct again after an edit
 * rebuilt the tree. The offset comes from the shared DOM↔raw walk and the construct from the
 * reveal chain, so the card addresses exactly what the render path drew.
 */

import { ambientLengthOf } from '../../../ambient/ambient-dom';
import { resolvedInlineContent } from '../../../core/inline/inline-cache';
import type { InlineNode } from '../../../core/nodes';
import type { NodeView } from '../../../core/node-views';
import { toClampedRawOffset } from '../../../cursor/coordinate-spaces';
import { domTextOffsetAtNode } from '../../../cursor/widget-offset';
import type { LinkReferenceResolverRef } from '../../../editor-keys';
import { isCardEditableInlineKind } from '../../../schema/inline-construct-policy';
import { constructChainAtOffset } from './construct-reveal';

/** Both DOM shapes a bracketed link takes: `a` for an allowed scheme, `span.md-link-blocked` for a
 *  rejected one — and a blocked link is precisely the one a user opens the card to fix. */
export const LINK_ELEMENT_SELECTOR = '.md-link-content';

/** Path plus construct start, never a node reference: every commit rebuilds the inline tree and the
 *  DOM under it, so an open card re-resolves from this identity after each edit. */
export interface LinkTarget {
	path: number[];
	sourceStart: number;
}

export interface LinkPointResolution {
	target: LinkTarget;
	link: InlineNode;
}

export interface LinkPointQuery {
	/** The block's content element — the walk container the raw offset is measured in. */
	contentEl: HTMLElement;
	block: NodeView;
	path: number[];
	linkRef?: LinkReferenceResolverRef;
}

/** The link the caret sits inside, read after the pointer has seated it. */
export function resolveLinkAtPoint(query: LinkPointQuery): LinkPointResolution | null {
	const offset = caretRawOffset(query.contentEl);
	if (offset === null) return null;
	const inlines = resolvedInlineContent(query.block, query.linkRef);
	// Outermost-first, so the last card-editable construct in the chain is the one whose bytes
	// enclose the pointer most tightly. The chain itself is the reveal's, which admits only
	// revealable kinds, so an autolink never reaches this filter either way.
	const link = constructChainAtOffset(inlines, offset).filter(isCardEditable).at(-1);
	if (link === undefined) return null;
	return { target: { path: query.path, sourceStart: link.start }, link };
}

const isCardEditable = (node: InlineNode): boolean => isCardEditableInlineKind(node.kind);

/** The construct an open card is anchored to, re-read from the live tree; null once an edit moved
 *  or removed it. */
export function linkConstructAt(
	block: NodeView,
	sourceStart: number,
	linkRef?: LinkReferenceResolverRef
): InlineNode | null {
	return findLink(resolvedInlineContent(block, linkRef), sourceStart);
}

function findLink(nodes: InlineNode[], sourceStart: number): InlineNode | null {
	for (const node of nodes) {
		if (isCardEditable(node) && node.start === sourceStart) return node;
		const nested = node.children ? findLink(node.children, sourceStart) : null;
		if (nested) return nested;
	}
	return null;
}

function caretRawOffset(contentEl: HTMLElement): number | null {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0 || !sel.focusNode) return null;
	if (!contentEl.contains(sel.focusNode)) return null;
	return toClampedRawOffset(
		domTextOffsetAtNode(contentEl, sel.focusNode, sel.focusOffset),
		ambientLengthOf(contentEl)
	);
}
