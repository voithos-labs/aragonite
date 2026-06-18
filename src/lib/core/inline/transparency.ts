/**
 * Pure-data vertical transparency: does a block carry no column meaning, so
 * cross-block vertical traversal (Shift+Arrow, Ctrl+Shift+Home/End) should pass
 * over it? A block is transparent when its only inline content is widgets
 * (images, live `<br>`) and blank text; a container is transparent when every
 * child is. Mirrors the component-level `isVerticallyTransparent` (widget
 * interaction + container shim) but reads the CST node directly, so it answers
 * for an OFF-WINDOW (unmounted) block where no component exists (VR-6).
 *
 * Relies on `inlineContent` being populated for every prose node — the editor
 * shell parses the whole tree on load and maintains it per edit
 * (`parseAllInlineContent`), regardless of mount state, and with the LRD
 * resolver (so reference-style images resolve to `image`, not
 * `unresolvedReference`). A missing cache reads as not-transparent, matching the
 * component's `length === 0 → false` so an unparsed block degrades to "land on
 * it" rather than skipping it.
 *
 * Forward-coupling: this off-window correctness depends on the eager whole-tree
 * sweep. If `inlineContent` ever becomes lazy / window-scoped, off-window leaves
 * lose their cache and degrade to not-transparent (reinstating VR-6) — that work
 * must keep transparency answerable for off-window nodes.
 */

import type { CstNode } from '../nodes';
import { isLiveWidgetInline } from './raw-html-widget';

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
	const inlines = node.inlineContent;
	if (!inlines || inlines.length === 0) return false;
	for (const inline of inlines) {
		if (isLiveWidgetInline(inline, node.raw)) continue;
		if (inline.kind === 'text' && (inline.text ?? '').trim() === '') continue;
		return false;
	}
	return true;
}
