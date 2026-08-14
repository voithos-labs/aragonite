/**
 * Pure primitives for cross-block selection: types, document-order walking, overlay
 * classification. No DOM, no state. Path-level predicates live in `./path-math`.
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

/** Char-space endpoint: `offset` is a character index into the leaf's `raw`. */
export interface CharSelectionPoint {
	path: number[];
	offset: number;
	cellCoordinate?: false;
}

/** Cell-space endpoint: `offset` is a row-major table cell index; `path` addresses the table block. */
export interface CellSelectionPoint {
	path: number[];
	offset: number;
	cellCoordinate: true;
}

/**
 * A single selection endpoint, discriminated on `cellCoordinate`; empty path is the
 * document root. `offset` keeps its name on both arms, and its space is the
 * discriminant's job: read it through {@link charOffsetOf} / {@link cellIndexOf}.
 * Exception: intra-table selections share the table path and carry cell-valued offsets
 * on UNFLAGGED points, established by their shared scope rather than the flag.
 */
export type SelectionPoint = CharSelectionPoint | CellSelectionPoint;

/** An endpoint whose block offered no position to land on; the funnel resolves the side. */
export interface WholeBlockEndpoint {
	path: number[];
	wholeBlock: true;
}

/**
 * What an entry path may hand the selection funnel. Only {@link SelectionPoint} is ever
 * stored, so an unresolved endpoint cannot reach a consumer.
 */
export type SelectionEndpoint = SelectionPoint | WholeBlockEndpoint;

export function isWholeBlockEndpoint(endpoint: SelectionEndpoint): endpoint is WholeBlockEndpoint {
	return 'wholeBlock' in endpoint;
}

/**
 * Anchor/focus pair. Same path + same offset is collapsed; same path + different offsets
 * is a single-block range the browser owns (SelectionState stays null); different paths
 * is cross-block.
 */
export interface EditorSelection {
	anchor: SelectionPoint;
	focus: SelectionPoint;
}

/** Offset as a char index into the leaf's `raw`. DEV-warns on a cell point, but always returns. */
export function charOffsetOf(point: SelectionPoint, tag: string): RawOffset {
	if (point.cellCoordinate) {
		devWarn(tag, 'char-offset site received a cell-coordinate SelectionPoint', point);
	}
	return asRawOffset(point.offset);
}

/** Offset as a row-major table cell index. DEV-warns on a char point, but always returns. */
export function cellIndexOf(point: SelectionPoint, tag: string): CellIndex {
	if (!point.cellCoordinate) {
		devWarn(tag, 'cell-index site received a char-offset SelectionPoint', point);
	}
	return asCellIndex(point.offset);
}

// ── Normalization ──────────────────────────────────────────────────────────

/**
 * `{start, end}` in document order: by path, then by offset when paths match. Published on the
 * consumer barrel as `normalizeSelection`, which is what a host anchors UI to. The offset tiebreak
 * is coordinate-space agnostic: two endpoints sharing a table's path carry row-major CELL indices,
 * whose order IS document order inside that table. A caller with no selection has nothing to
 * order, since `getSelection()` answers null with nothing focused and at a gap caret.
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

/** Every block path strictly between `start` and `end`, at every nesting level. */
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
 * Position of a block relative to a selection, for overlay rendering. 'single-block'
 * tells the caller to delegate to the browser instead of painting.
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
