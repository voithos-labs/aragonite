/**
 * Pure-data vertical transparency: does a block carry no column meaning, so
 * cross-block vertical traversal (Shift+Arrow, Ctrl+Shift+Home/End) should pass
 * over it? A block is transparent when its only inline content is widgets
 * (images, live `<br>`) and blank text; a container is transparent when every
 * child is. The single implementation of the vertical-skip decision: the widget
 * interaction and container components delegate here. It reads the inline tree
 * through `getInlineContent` (computed on demand), so it answers for an
 * off-window (unmounted) leaf where no component exists. An empty result reads
 * as not-transparent, so an unparsed block degrades to "land on it".
 */

import type { NodeView } from '../node-views';
import { getInlineContent } from './inline-cache';
import { isInlineWidget, getInlineWidgetEditing } from './inline-widgets';

export function isVerticallyTransparentNode(node: NodeView | null | undefined): boolean {
	if (!node) return false;
	// Table kinds are never transparent: a cell is a grid-column landing, and images
	// render there as alt text, not as skippable widgets. Without this gate the
	// children-recursion below would skip an image-only cell (VR-6).
	if (node.kind === 'table' || node.kind === 'tableRow' || node.kind === 'tableCell') return false;
	if (node.children) {
		// An empty container carries a caret position; `[].every() === true` would
		// wrongly read it as transparent.
		if (node.children.length === 0) return false;
		return node.children.every(isVerticallyTransparentNode);
	}
	// No resolver: transparency stays LRD-free so the path-walkers that call it
	// carry none either. The cost is that a reference-style-image-only paragraph
	// reads as opaque and is never skipped — direct `![](url)` images are
	// unaffected, and in-block cursor handling resolves references elsewhere.
	const inlines = getInlineContent(node);
	if (inlines.length === 0) return false;
	for (const inline of inlines) {
		if (isInlineWidget(inline, node.raw)) {
			// A step-over widget (inline entity glyph) is character-like: it carries a
			// column, so it makes the block opaque like real text. Select-model widgets
			// (image, <br>) carry no column meaning and stay skippable.
			if (getInlineWidgetEditing(inline.kind)?.onEdge === 'step-over') return false;
			continue;
		}
		if (inline.kind === 'text' && (inline.text ?? '').trim() === '') continue;
		return false;
	}
	return true;
}
