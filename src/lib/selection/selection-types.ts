/**
 * Types for the cross-block selection layer.
 * See docs/design/editor/editor.md Selection section and
 * docs/superpowers/specs/2026-04-15-v0.4-selection-clipboard-design.md.
 */

// ── Selection points ────────────────────────────────────────────────────────

/**
 * A single endpoint of a selection. Addresses any leaf block in the document
 * tree via a path of child indices, plus a character offset into the leaf's
 * `raw` field.
 *
 * path: [2, 0, 1] means doc.children[2].children[0].children[1].
 * An empty path ([]) is the document root.
 */
export interface SelectionPoint {
	path: number[];
	offset: number;
}

/**
 * Anchor/focus pair. A collapsed selection has `anchor === focus` by value.
 * `anchor.path === focus.path` with different offsets is a single-block range
 * (native browser handles it; runtime SelectionState stays null). Different
 * paths is a cross-block range.
 */
export interface EditorSelection {
	anchor: SelectionPoint;
	focus: SelectionPoint;
}

/**
 * Shadow value captured at pointerdown — the anchor of a potential cross-block
 * drag before it has escaped the original block. null when no drag is active.
 */
export type SelectionDragStart = SelectionPoint | null;
