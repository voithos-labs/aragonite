/**
 * Pure primitives for cross-block selection: types, document-order
 * walking, and overlay classification. No DOM, no state. Path-level
 * predicates live in `./path-math`.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { comparePaths, isPathBetween } from './path-math';
import {
	asCellIndex,
	asRawOffset,
	type CellIndex,
	type RawOffset
} from '../cursor/coordinate-spaces';
import { devWarn } from '../dev-warn';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * A single selection endpoint: path of child indices plus an offset whose
 * meaning depends on `cellCoordinate`. Empty path is the document root.
 *
 * `offset` is a character index into the leaf's `raw` by default. On a table
 * endpoint it is instead a row-major cell index (`cellCoordinate: true`), with
 * the path addressing the table block rather than a deep cell leaf. The generic
 * document-order ops here (`comparePaths`, `normalize`, `walkBetween`,
 * `classifyBlockForSelection`) compare offsets numerically and are correct under
 * either meaning. Consumers read the field through {@link charOffsetOf} or
 * {@link cellIndexOf} — the accessor for their branch mints the matching brand
 * and DEV-warns on the wrong space.
 */
export interface SelectionPoint {
	path: number[];
	offset: number;
	cellCoordinate?: boolean;
}

/**
 * Anchor/focus pair. Same path + same offset is collapsed; same path +
 * different offsets is a single-block range (handled natively; runtime
 * SelectionState stays null); different paths is cross-block.
 */
export interface EditorSelection {
	anchor: SelectionPoint;
	focus: SelectionPoint;
}

/**
 * Pointerdown anchor of a potential cross-block drag before it has escaped
 * the original block. Null when no drag is active.
 */
export type SelectionDragStart = SelectionPoint | null;

/**
 * Read a point's offset as a character index into the leaf's `raw` (the caller
 * slices `raw` or places a caret by character). Warns in DEV if the point
 * instead carries a cell coordinate — the space mismatch is the caret-corruption
 * class the brand splits. Always returns the value, minted `RawOffset`.
 */
export function charOffsetOf(point: SelectionPoint, tag: string): RawOffset {
	if (point.cellCoordinate) {
		devWarn(tag, 'char-offset site received a cell-coordinate SelectionPoint', point);
	}
	return asRawOffset(point.offset);
}

/**
 * Read a point's offset as a row-major table cell index (the caller decodes it
 * into row/column). Warns in DEV when the point is NOT a cell coordinate — the
 * mirror of {@link charOffsetOf}. Always returns the value, minted `CellIndex`.
 */
export function cellIndexOf(point: SelectionPoint, tag: string): CellIndex {
	if (!point.cellCoordinate) {
		devWarn(tag, 'cell-index site received a char-offset SelectionPoint', point);
	}
	return asCellIndex(point.offset);
}

// ── Normalization ──────────────────────────────────────────────────────────

/**
 * Normalize to {start, end} where start <= end in document order
 * (by path, then by offset when paths match).
 */
export function normalize(selection: EditorSelection): {
	start: SelectionPoint;
	end: SelectionPoint;
} {
	const { anchor, focus } = selection;
	const cmp = comparePaths(anchor.path, focus.path);
	if (cmp < 0) return { start: anchor, end: focus };
	if (cmp > 0) return { start: focus, end: anchor };
	if (anchor.offset <= focus.offset) return { start: anchor, end: focus };
	return { start: focus, end: anchor };
}

// ── Range walk ─────────────────────────────────────────────────────────────

/**
 * Every block path strictly between `start` and `end` in document order
 * (exclusive of both endpoints). Walks every nesting level.
 */
export function walkBetween(doc: DocumentView, start: number[], end: number[]): number[][] {
	if (comparePaths(start, end) >= 0) return [];

	const result: number[][] = [];

	function visit(node: NodeView | DocumentView, path: number[]): void {
		if (isPathBetween(path, start, end)) {
			result.push([...path]);
		}
		if (!node.children) return;
		for (let i = 0; i < node.children.length; i++) {
			const childPath = [...path, i];
			// Skip subtrees that are entirely before start or after end.
			const firstDescendant = [...childPath];
			const lastDescendant = [...childPath, ...Array(8).fill(Number.MAX_SAFE_INTEGER)];
			if (comparePaths(lastDescendant, start) <= 0) continue;
			if (comparePaths(firstDescendant, end) >= 0) break;
			visit(node.children[i], childPath);
		}
	}

	visit(doc, []);
	return result;
}

// ── Overlay classification ─────────────────────────────────────────────────

export type BlockSelectionClass = 'outside' | 'start' | 'middle' | 'end' | 'single-block';

/**
 * Classify a block's position relative to a selection for overlay rendering.
 * 'single-block' is returned so callers can delegate to the browser instead
 * of painting an overlay.
 */
export function classifyBlockForSelection(
	path: number[],
	selection: EditorSelection
): BlockSelectionClass {
	const { start, end } = normalize(selection);
	if (comparePaths(start.path, end.path) === 0) {
		return comparePaths(path, start.path) === 0 ? 'single-block' : 'outside';
	}
	if (comparePaths(path, start.path) === 0) return 'start';
	if (comparePaths(path, end.path) === 0) return 'end';
	if (isPathBetween(path, start.path, end.path)) return 'middle';
	return 'outside';
}
