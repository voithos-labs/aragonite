/**
 * Pure primitives for cross-block selection: types, document-order walking, overlay
 * classification, the delete-commit snapshot rule. No DOM, no state. Path-level predicates
 * live in `./path-math`.
 */

import type { CommitSnapshotArg, UndoEntryMode } from '../action-contracts';
import type { DocumentView, NodeView } from '../core/node-views';
import {
	comparePaths,
	isPathBetween,
	isStrictAncestorOf,
	pathHasPrefix,
	pathsEqual
} from './path-math';
import {
	asCellIndex,
	asRawOffset,
	docPathFrom,
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

/** An inline widget selected whole (an image), as the raw span of the block at `path`. */
export interface SelectedWidgetRange {
	path: number[];
	start: number;
	end: number;
}

/** The widget selected whole, read live, and the way to end that selection. */
export interface SelectedWidgetHandle {
	range(): SelectedWidgetRange | null;
	clear(): void;
}

/** Cell-space endpoint: `offset` is a row-major table cell index; `path` addresses the table block. */
export interface CellSelectionPoint {
	path: number[];
	offset: number;
	cellCoordinate: true;
}

/**
 * One selection endpoint, discriminated on `cellCoordinate`; an empty path is the document
 * root. `offset` keeps its name on both variants and the flag says which space it is in, so
 * read it through {@link charOffsetOf} or {@link cellIndexOf}. The exception: a selection
 * inside one table shares the table path and carries cell indices on unflagged points.
 */
export type SelectionPoint = CharSelectionPoint | CellSelectionPoint;

/** An endpoint whose block offered no position to land on; its side is resolved against the
 *  other endpoint when the range is entered. */
export interface WholeBlockEndpoint {
	path: number[];
	wholeBlock: true;
}

/**
 * What a gesture may hand `enterCrossBlock`. Only a {@link SelectionPoint} is ever stored, so
 * an unresolved endpoint cannot reach a consumer.
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

/** Whether two snapshots name the same selection. The coordinate space counts: the same
 *  numbers as a cell index and as a character offset are different positions. */
export function selectionsEqual(a: EditorSelection | null, b: EditorSelection | null): boolean {
	if (a === null || b === null) return a === b;
	return pointsEqual(a.anchor, b.anchor) && pointsEqual(a.focus, b.focus);
}

function pointsEqual(a: SelectionPoint, b: SelectionPoint): boolean {
	return (
		a.offset === b.offset && !a.cellCoordinate === !b.cellCoordinate && pathsEqual(a.path, b.path)
	);
}

/** Offset as a char index into the leaf's `raw`. Warns in dev on a cell point, but always returns. */
export function charOffsetOf(point: SelectionPoint, tag: string): RawOffset {
	if (point.cellCoordinate) {
		devWarn(tag, 'char-offset site received a cell-coordinate SelectionPoint', point);
	}
	return asRawOffset(point.offset);
}

/** Offset as a row-major table cell index. Warns in dev on a char point, but always returns. */
export function cellIndexOf(point: SelectionPoint, tag: string): CellIndex {
	if (!point.cellCoordinate) {
		devWarn(tag, 'cell-index site received a char-offset SelectionPoint', point);
	}
	return asCellIndex(point.offset);
}

// ── Normalization ──────────────────────────────────────────────────────────

/**
 * `{start, end}` in document order: by path, then by offset when the paths match. Exported to
 * consumers as `normalizeSelection`. The offset tiebreak works in either space: two endpoints
 * sharing a table's path carry row-major cell indices, whose order is document order inside
 * that table.
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

// ── Undo snapshot ──────────────────────────────────────────────────────────

/** A join delete uses the caller's undo snapshot; every other delete records its own position. */
export function deleteSnapshot(
	options: { undoEntry?: UndoEntryMode } | undefined,
	path: number[],
	offset = 0
): CommitSnapshotArg {
	return options?.undoEntry === 'join' ? 'skip' : { path: docPathFrom(path), offset };
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
			// Skip subtrees entirely before start (an ancestor of start still holds it) or after end.
			if (!pathHasPrefix(start, childPath) && comparePaths(childPath, start) < 0) continue;
			if (comparePaths(childPath, end) >= 0) break;
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

/**
 * Whether this block paints the range over its whole box: the range holds its entire subtree and
 * no ancestor's box already covers it, or it is the one block a whole-block range holds. A
 * container's own decoration (a GitHub alert's badge) has no child host to paint it, so the
 * covering block takes the box in one piece and its children paint nothing.
 */
export function blockPaintsWholeBox(
	path: readonly number[],
	selection: EditorSelection,
	wholeUnitPath: readonly number[] | null
): boolean {
	if (wholeUnitPath) return pathsEqual(path, wholeUnitPath);
	const { start, end } = normalize(selection);
	return (
		holdsSubtree(path, start.path, end.path) &&
		!holdsSubtree(path.slice(0, -1), start.path, end.path)
	);
}

/** The range holds this block's whole subtree: inside it in document order, and not an ancestor
 *  of the end endpoint, whose own descendants the range cuts through. */
function holdsSubtree(path: readonly number[], start: number[], end: number[]): boolean {
	return isPathBetween(path, start, end) && !isStrictAncestorOf(path, end);
}
