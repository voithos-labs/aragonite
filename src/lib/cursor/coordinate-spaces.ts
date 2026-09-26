/**
 * The editor's coordinate spaces as branded numbers (G3.7), so mixing them is a type error
 * instead of a caret bug later. A brand is produced only by the module that owns its space or
 * by an `as*` cast at a declared public entry point (G4.15's rows in `lint/file-rules.test.ts`
 * hold that list closed), and moves between spaces only through the conversions below, one
 * function per direction. Public API entry points take `number` and brand it once.
 */

import type { DocPath } from '../selection/path-math';

// ── Brands ───────────────────────────────────────────────────────────────────

declare const rawOffsetBrand: unique symbol;
/** Byte offset into a block node's raw content (CST-facing; the container's marker prefix excluded). */
export type RawOffset = number & { readonly [rawOffsetBrand]: true };

declare const domTextOffsetBrand: unique symbol;
/**
 * Offset as the DOM walk counts it: the raw offset plus the leading marker prefix's text length.
 * Produced only by `cursor/widget-offset.ts`.
 */
export type DomTextOffset = number & { readonly [domTextOffsetBrand]: true };

declare const editorXBrand: unique symbol;
/** Editor-relative pixel X (viewport X minus the editor container's left), unaffected by scrolling. */
export type EditorX = number & { readonly [editorXBrand]: true };

declare const viewportXBrand: unique symbol;
/** Raw client-rect pixel X. */
export type ViewportX = number & { readonly [viewportXBrand]: true };

declare const cellIndexBrand: unique symbol;
/** Row-major table cell index, declared here rather than in the table code so the
 *  `as CellIndex` lint rule exists before the first cast does. */
export type CellIndex = number & { readonly [cellIndexBrand]: true };

// ── Conversions (between spaces, one function per direction) ─────────────────

export function toDomTextOffset(raw: RawOffset, ambientLength: number): DomTextOffset {
	return (raw + ambientLength) as DomTextOffset;
}

export function toRawOffset(domText: DomTextOffset, ambientLength: number): RawOffset {
	return (domText - ambientLength) as RawOffset;
}

/** `toRawOffset` clamped to raw 0, for DOM reads that may land inside the leading marker
 *  prefix, where the unclamped result goes negative. */
export function toClampedRawOffset(domText: DomTextOffset, ambientLength: number): RawOffset {
	return Math.max(0, toRawOffset(domText, ambientLength)) as RawOffset;
}

export function toEditorX(viewport: ViewportX, editorLeft: number): EditorX {
	return (viewport - editorLeft) as EditorX;
}

export function toViewportX(editor: EditorX, editorLeft: number): ViewportX {
	return (editor + editorLeft) as ViewportX;
}

// ── Brand casts (owning modules and declared entry points only; see the lint) ─

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

export function asCellIndex(n: number): CellIndex {
	return n as CellIndex;
}

// ── Cell grid decode ─────────────────────────────────────────────────────────

/** Row-major cell index to `{ row, col }` for a table of `colCount` columns. Takes a plain
 *  number so a `CellIndex` and a bare loop counter both reach it without a cast. */
export function cellRowCol(cellIdx: number, colCount: number): { row: number; col: number } {
	const row = Math.floor(cellIdx / colCount);
	return { row, col: cellIdx - row * colCount };
}

// ── DocPath composition (document-absolute path helpers, in a dependency-free module) ──
//
// Here so `tree-operations/` can compose paths without importing `selection/`; the casts are
// bare because importing `selection/path-math.ts` at runtime would close an import cycle.

/** Append a child index to a parent path, yielding a document-absolute path. */
export function extendDocPath(parent: readonly number[], index: number): DocPath {
	return [...parent, index] as DocPath;
}

/** Brand a complete document-absolute path (copied) for callers that already hold one;
 *  `extendDocPath` covers the parent-plus-index case, this covers the rest. */
export function docPathFrom(indices: readonly number[]): DocPath {
	return [...indices] as DocPath;
}
