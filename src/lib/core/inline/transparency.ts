/**
 * Pure-data vertical transparency: does a block carry no column meaning, so
 * cross-block vertical traversal (Shift+Arrow, Ctrl+Shift+Home/End) should pass
 * over it? A block is transparent when its only inline content is widgets
 * (images, live `<br>`) and blank text; a container is transparent when every
 * child is. Mirrors the component-level `isVerticallyTransparent` (widget
 * interaction + container shim) but reads the CST node directly, so it answers
 * for an OFF-WINDOW (unmounted) block where no component exists (VR-6).
 *
 * Reads the inline tree through `getInlineContent`, which computes on demand —
 * so it answers for an off-window (unmounted) leaf where no component exists and
 * the eager field may be absent. An empty result reads as not-transparent,
 * matching the component's `length === 0 → false` so an unparsed block degrades
 * to "land on it" rather than skipping it.
 */

import type { CstNode } from '../nodes';
import { getInlineContent } from './inline-cache';
import { isInlineWidget } from './inline-widgets';

export function isVerticallyTransparentNode(node: CstNode | null | undefined): boolean {
	if (!node) return false;
	// Table kinds are never transparent: a cell is a grid-column landing (images
	// render as alt-text there, not skippable widgets), and no table component
	// exposed the old per-component gate. Without this, children-recursion plus a
	// table cell's inline cache would skip an image-only cell — a divergence from
	// the pre-VR-6 behavior the rest of this predicate faithfully preserves.
	if (node.kind === 'table' || node.kind === 'tableRow' || node.kind === 'tableCell') return false;
	if (node.children) {
		// An empty container carries a caret position; `[].every() === true` would
		// wrongly read it as transparent.
		if (node.children.length === 0) return false;
		return node.children.every(isVerticallyTransparentNode);
	}
	// No resolver: transparency is the vertical-skip decision and stays LRD-free
	// so the path-walkers that call it carry no resolver. The only effect is that
	// a rare reference-style-image-only paragraph isn't auto-skipped on vertical
	// arrow; direct `![](url)` images are unaffected, and in-block cursor handling
	// stays resolver-correct via the component readers.
	const inlines = getInlineContent(node);
	if (inlines.length === 0) return false;
	for (const inline of inlines) {
		if (isInlineWidget(inline, node.raw)) continue;
		if (inline.kind === 'text' && (inline.text ?? '').trim() === '') continue;
		return false;
	}
	return true;
}
