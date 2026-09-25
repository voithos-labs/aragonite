/**
 * Which link a click landed in, and how to find that link again after an edit rebuilt the tree.
 * The offset comes from the shared DOM-to-raw traversal and the link from the same chain used
 * when a construct shows its source, so the card points at exactly what was drawn.
 */

import { ambientLengthOf } from '../../../ambient/ambient-dom';
import { inlineDescendants } from '../../../core/inline';
import { resolvedInlineContent } from '../../../core/inline/inline-cache';
import type { InlineNode } from '../../../core/nodes';
import type { NodeView } from '../../../core/node-views';
import { toClampedRawOffset } from '../../../cursor/coordinate-spaces';
import { domTextOffsetAtNode } from '../../../cursor/widget-offset';
import { isCardEditableInlineKind } from '../../../schema/inline-construct-policy';
import { constructChainAtOffset } from './construct-reveal';
import type { Reading } from '../../../schema/reading';

/** Both DOM shapes a bracketed link takes: `a` for an allowed scheme, `span.md-link-blocked` for a
 *  rejected one, and a blocked link is exactly the one a user opens the card to fix. */
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
	/** The block's content element, the container the raw offset is measured inside. */
	contentEl: HTMLElement;
	block: NodeView;
	path: number[];
	reading: Reading;
}

/** The link the caret sits inside, read after the click has placed the caret. */
export function resolveLinkAtPoint(query: LinkPointQuery): LinkPointResolution | null {
	const offset = caretRawOffset(query.contentEl);
	if (offset === null) return null;
	const inlines = resolvedInlineContent(query.block, query.reading);
	// Outermost first, so the last card-editable link in the chain is the one whose bytes enclose
	// the click most tightly. It is the same chain used when a construct shows its source, which
	// admits only kinds that can do so, so an autolink never reaches this filter anyway.
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
	reading: Reading
): InlineNode | null {
	for (const node of inlineDescendants(resolvedInlineContent(block, reading))) {
		if (isCardEditable(node) && node.start === sourceStart) return node;
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
