/**
 * The single implementation of the vertical-skip decision: does a block carry no column meaning,
 * so cross-block vertical traversal should pass over it? Reads the inline tree on demand, so it
 * answers for an off-window leaf with no component. An empty result reads as not-transparent, so
 * an unparsed block degrades to "land on it".
 */

import type { NodeView } from '../node-views';
import { getInlineContent } from './inline-cache';
import { isInlineWidget, isCharacterLikeWidget } from './inline-widgets';
import type { GrammarView } from '../../schema/block-openers';

export function isVerticallyTransparentNode(
	node: NodeView | null | undefined,
	grammar: GrammarView
): boolean {
	if (!node) return false;
	// An explicit stack: container depth is input-controlled, so recursion could overflow.
	const pending: NodeView[] = [node];
	while (pending.length > 0) {
		const current = pending.pop()!;
		// A cell is a grid-column landing and renders images as alt text, so without this gate the
		// walk would skip an image-only cell (VR-6).
		const kind = current.kind;
		if (kind === 'table' || kind === 'tableRow' || kind === 'tableCell') return false;
		if (current.children) {
			// An empty container carries a caret position.
			if (current.children.length === 0) return false;
			for (const child of current.children) pending.push(child);
		} else if (!isTransparentLeaf(current, grammar)) {
			return false;
		}
	}
	return true;
}

function isTransparentLeaf(node: NodeView, grammar: GrammarView): boolean {
	// No resolver, so the path-walkers that call this carry none either. The cost is that a
	// reference-style-image-only paragraph reads as opaque; direct `![](url)` is unaffected.
	const inlines = getInlineContent(node, undefined, '', grammar);
	if (inlines.length === 0) return false;
	for (const inline of inlines) {
		if (isInlineWidget(inline, node.raw, grammar)) {
			// A character-like widget carries a column, so it reads as text.
			if (isCharacterLikeWidget(inline.kind, grammar)) return false;
			continue;
		}
		if (inline.kind === 'text' && (inline.text ?? '').trim() === '') continue;
		return false;
	}
	return true;
}
