/**
 * The single implementation of the vertical-skip decision: does a block carry no column meaning,
 * so cross-block vertical traversal should pass over it? Reads the inline tree on demand, so it
 * answers for an off-window leaf with no component. An empty result reads as not-transparent, so
 * an unparsed block degrades to "land on it".
 */

import type { NodeView } from '../node-views';
import { getInlineContent } from './inline-cache';
import { isInlineWidget, getInlineWidgetEditing } from './inline-widgets';

export function isVerticallyTransparentNode(node: NodeView | null | undefined): boolean {
	if (!node) return false;
	// A cell is a grid-column landing and renders images as alt text, so without this gate the
	// recursion below would skip an image-only cell (VR-6).
	if (node.kind === 'table' || node.kind === 'tableRow' || node.kind === 'tableCell') return false;
	if (node.children) {
		// An empty container carries a caret position; `[].every()` is true and would skip it.
		if (node.children.length === 0) return false;
		return node.children.every(isVerticallyTransparentNode);
	}
	// No resolver, so the path-walkers that call this carry none either. The cost is that a
	// reference-style-image-only paragraph reads as opaque; direct `![](url)` is unaffected.
	const inlines = getInlineContent(node);
	if (inlines.length === 0) return false;
	for (const inline of inlines) {
		if (isInlineWidget(inline, node.raw)) {
			// A step-over widget is character-like: it carries a column, so it reads as text.
			if (getInlineWidgetEditing(inline.kind)?.onEdge === 'step-over') return false;
			continue;
		}
		if (inline.kind === 'text' && (inline.text ?? '').trim() === '') continue;
		return false;
	}
	return true;
}
