/**
 * What you'd go to at the caret: a link (the card edits it) or a widget that goes somewhere (its
 * source edits it), and how to find a link again after an edit rebuilt the tree. The click card,
 * Mod+K and the "Edit link" menu row all read `followTargetAt`.
 */

import { inlineDescendants } from '../../../core/inline';
import { resolvedInlineContent } from '../../../core/inline/inline-cache';
import type { InlineNode } from '../../../core/nodes';
import type { NodeView } from '../../../core/node-views';
import { rawOffsetAt } from '../../../caret/widget-offset';
import { isCardEditableInlineKind } from '../../../schema/inline-construct-policy';
import { getInlineWidgetEditing } from '../../../core/inline/inline-widgets';
import { widgetsIn } from './widget-adjacency';
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

/** What you'd go to at a raw offset, by how it's edited: a link in its card, a widget by its source. */
export type FollowTarget =
	{ edit: 'card'; link: InlineNode } | { edit: 'source'; widget: InlineNode; atEnd: boolean };

/** The innermost link around `offset` in live mode, else (any editable mode) a widget it touches
 *  whose kind claims the activation click. */
export function followTargetAt(
	block: NodeView,
	offset: number,
	reading: Reading
): FollowTarget | null {
	const mode = reading.mode();
	if (mode === 'reading') return null;
	const inlines = resolvedInlineContent(block, reading);
	if (mode === 'live') {
		// The chain is outermost first, so its last card-editable link encloses the offset most tightly.
		const link = constructChainAtOffset(inlines, offset).filter(isCardEditable).at(-1);
		if (link) return { edit: 'card', link };
	}
	const widget = widgetsIn(block, reading).find(
		(w) =>
			w.start <= offset &&
			offset <= w.end &&
			getInlineWidgetEditing(w.kind, reading.grammar)?.claimsActivationClick === true
	);
	return widget ? { edit: 'source', widget, atEnd: offset === widget.end } : null;
}

/** What you'd go to at the caret, read after a click or a key has placed it. */
export function followTargetAtCaret(query: LinkPointQuery): FollowTarget | null {
	const offset = caretRawOffset(query.contentEl);
	return offset === null ? null : followTargetAt(query.block, offset, query.reading);
}

/** The link the caret sits inside, read after the click has placed the caret. */
export function resolveLinkAtPoint(query: LinkPointQuery): LinkPointResolution | null {
	const hit = followTargetAtCaret(query);
	if (hit?.edit !== 'card') return null;
	return { target: { path: query.path, sourceStart: hit.link.start }, link: hit.link };
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
	return rawOffsetAt(contentEl, sel.focusNode, sel.focusOffset);
}
