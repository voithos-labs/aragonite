/**
 * The editor's coordinate spaces as branded numbers. Every offset bug in the
 * 2026-07 audit was arithmetic mixing spaces that were all `number`; the brands
 * make that mixing a type error at the seam instead of a caret bug later.
 *
 * Rules of the system:
 * - A brand is produced only by its space's home module (the module that
 *   computes the space) or by an `as*` boundary mint at a declared public door.
 * - Everything else moves between spaces through the named conversions below —
 *   the inter-space arithmetic has exactly one home per direction.
 * - Public API doors (BlockComponent methods, action contracts) keep `number`
 *   and mint once at entry. `asRawOffset|asDomTextOffset|asEditorX|asViewportX`
 *   greps to every door; the coordinate-brand-mints lint holds that list closed.
 *
 * CURSOR_END rides through public doors as a plain number and is deliberately
 * laundered into RawOffset by the door mint: the offset walkers clamp any
 * over-length offset to end-of-content, so the sentinel needs no union in
 * branded signatures. A future branded seam that must accept it explicitly
 * takes `RawOffset | CursorEnd`.
 */

// ── Brands ───────────────────────────────────────────────────────────────────

declare const rawOffsetBrand: unique symbol;
/** Byte offset into a block node's raw content (CST-facing; ambient marker excluded). */
export type RawOffset = number & { readonly [rawOffsetBrand]: true };

declare const domTextOffsetBrand: unique symbol;
/**
 * Offset in the widget-offset walk space: raw offset plus the leading ambient
 * marker's text length. Home: `cursor/widget-offset.ts` (the walk) with
 * `cursor/content-offsets.ts` as the widget-free equivalent.
 */
export type DomTextOffset = number & { readonly [domTextOffsetBrand]: true };

declare const editorXBrand: unique symbol;
/** Editor-relative pixel X (viewport X minus the editor container's left) — scroll-invariant. */
export type EditorX = number & { readonly [editorXBrand]: true };

declare const viewportXBrand: unique symbol;
/** Raw client-rect pixel X. */
export type ViewportX = number & { readonly [viewportXBrand]: true };

declare const cellIndexBrand: unique symbol;
/**
 * Row-major table cell index. Declared ahead of its home's conversion so the
 * `as CellIndex` lint rule exists before the first cast does.
 */
export type CellIndex = number & { readonly [cellIndexBrand]: true };

// ── Conversions (the inter-space arithmetic — one home per direction) ────────

export function toDomTextOffset(raw: RawOffset, ambientLength: number): DomTextOffset {
	return (raw + ambientLength) as DomTextOffset;
}

export function toRawOffset(domText: DomTextOffset, ambientLength: number): RawOffset {
	return (domText - ambientLength) as RawOffset;
}

/**
 * `toRawOffset` clamped to raw 0 — the shared shape of every DOM read that may
 * land inside the leading ambient marker, where the unclamped result goes
 * negative.
 */
export function toClampedRawOffset(domText: DomTextOffset, ambientLength: number): RawOffset {
	return Math.max(0, toRawOffset(domText, ambientLength)) as RawOffset;
}

export function toEditorX(viewport: ViewportX, editorLeft: number): EditorX {
	return (viewport - editorLeft) as EditorX;
}

export function toViewportX(editor: EditorX, editorLeft: number): ViewportX {
	return (editor + editorLeft) as ViewportX;
}

// ── Boundary mints (space homes and declared doors only — see the lint) ──────

export function asRawOffset(n: number): RawOffset {
	return n as RawOffset;
}

export function asDomTextOffset(n: number): DomTextOffset {
	return n as DomTextOffset;
}

export function asEditorX(n: number): EditorX {
	return n as EditorX;
}

export function asViewportX(n: number): ViewportX {
	return n as ViewportX;
}
