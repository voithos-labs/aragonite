/**
 * What a click at a point goes to and how Edit link edits it: a link (an autolink too) in its
 * card, a widget by its source. The follow path and the edit path both ask here, so anything a
 * click follows can be edited. Also how to find a link again after an edit.
 */

import { inlineDescendants } from '../../../core/inline';
import { resolvedInlineContent } from '../../../core/inline/inline-cache';
import type { InlineNode } from '../../../core/nodes';
import type { NodeView } from '../../../core/node-views';
import { rawSelectionFocus } from '../../../browser/selection-read';
import { followEditOf } from '../../../schema/inline-construct-policy';
import { claimsActivationClick, getInlineWidgetEditing } from '../../../core/inline/inline-widgets';
import { widgetsIn } from './widget-adjacency';
import type { Reading } from '../../../schema/reading';

/** Every element a link the card edits renders as, a bracketed link or an autolink: `a` for an
 *  allowed scheme, a span for a rejected one, which is exactly the link a user opens the card to fix. */
export const LINK_ELEMENT_SELECTOR = '.md-link-content, .md-autolink';

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

/** What you'd go to at a raw offset, by how it's edited: a link in its card, a widget by its
 *  source. */
export type FollowTarget =
	{ edit: 'card'; link: InlineNode } | { edit: 'source'; widget: InlineNode; atEnd: boolean };

/** The innermost construct around `offset` that a click follows, in any mode. */
export function followedConstructAt(
	block: NodeView,
	offset: number,
	reading: Reading
): InlineNode | null {
	const holds = (node: InlineNode): boolean => offset >= node.start && offset <= node.end;
	let innermost: InlineNode | null = null;
	for (const node of inlineDescendants(resolvedInlineContent(block, reading), holds)) {
		if (holds(node) && followEditOf(node.kind)) innermost = node;
	}
	return innermost;
}

/** What Edit link edits at `offset`: the construct a click follows, in live mode only since the
 *  others show its syntax, or in any editable mode a widget it touches that claims the click. */
export function followTargetAt(
	block: NodeView,
	offset: number,
	reading: Reading
): FollowTarget | null {
	const mode = reading.mode();
	if (mode === 'reading') return null;
	if (mode === 'live') {
		const link = followedConstructAt(block, offset, reading);
		if (link) return { edit: 'card', link };
	}
	const widget = claimingWidgetAt(block, offset, reading);
	return widget ? { edit: 'source', widget, atEnd: offset === widget.end } : null;
}

/** Whether a click at `offset` follows something: a construct whose row says so, or a widget whose
 *  kind claims the activation click, the two things Edit link edits. */
export function clickFollowsAt(block: NodeView, offset: number, reading: Reading): boolean {
	return (
		followedConstructAt(block, offset, reading) !== null ||
		claimingWidgetAt(block, offset, reading) !== null
	);
}

function claimingWidgetAt(block: NodeView, offset: number, reading: Reading): InlineNode | null {
	const claims = (w: InlineNode) =>
		claimsActivationClick(getInlineWidgetEditing(w.kind, reading.grammar));
	return (
		widgetsIn(block, reading).find((w) => w.start <= offset && offset <= w.end && claims(w)) ?? null
	);
}

/** What you'd go to at the caret, read after a click or a key has placed it. */
export function followTargetAtCaret(query: LinkPointQuery): FollowTarget | null {
	const offset = rawSelectionFocus(query.contentEl);
	return offset === null ? null : followTargetAt(query.block, offset, query.reading);
}

/** The link the caret sits inside, read after the click has placed the caret. */
export function resolveLinkAtPoint(query: LinkPointQuery): LinkPointResolution | null {
	const hit = followTargetAtCaret(query);
	if (hit?.edit !== 'card') return null;
	return { target: { path: query.path, sourceStart: hit.link.start }, link: hit.link };
}

/** The construct an open card is anchored to, re-read from the live tree; null once an edit moved
 *  or removed it. */
export function linkConstructAt(
	block: NodeView,
	sourceStart: number,
	reading: Reading
): InlineNode | null {
	for (const node of inlineDescendants(resolvedInlineContent(block, reading))) {
		if (followEditOf(node.kind) === 'card' && node.start === sourceStart) return node;
	}
	return null;
}
