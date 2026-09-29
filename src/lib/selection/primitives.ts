/**
 * Pure primitives for cross-block selection: types, overlay classification of a covered range,
 * the delete-commit snapshot rule. Path-level predicates live in `./path-math`.
 */

import type { CommitSnapshotArg } from '../action-contracts';
import { SELECTION_END } from '../block-component';
import type { RangeCoverage } from './range-coverage';
import { comparePaths, pathsEqual, type DocPath } from './path-math';
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
 * read it through {@link charOffsetOf} or {@link cellIndexOf}. `SelectionState` flags every
 * point on a table path, so a host may pass plain numbers there.
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

/** Where a caret goes after an edit: a document path, which may name a container, and an offset
 *  into the node there, raw or one of the special caret values in `block-component.ts`. */
export interface CaretPosition {
	readonly path: DocPath;
	readonly offset: number;
}

/** What an edit hands back for the caret: a position, or a stored selection to put back. */
export type Landing = CaretPosition | EditorSelection;

/** A cell endpoint: the grid's path, a row-major cell index, and the flag saying so. */
export function cellPoint(path: readonly number[], cellIdx: number): CellSelectionPoint {
	return { path: path.slice(), offset: cellIdx, cellCoordinate: true };
}

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

/** `{start, end}` in document order: by path, then by offset, which orders cell indices on a
 *  shared table path too, since row-major order is document order inside the table. */
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

/** Where undo puts the caret back after a range delete, when nothing is focused. */
export function deleteSnapshot(path: number[], offset = 0): CommitSnapshotArg {
	return { path: docPathFrom(path), offset };
}

// ── Overlay classification ─────────────────────────────────────────────────

export type BlockSelectionClass = 'outside' | 'start' | 'middle' | 'end' | 'single-block';

/** Where a block stands in a covered range, for the overlay: 'single-block' delegates to the
 *  browser, and a subtree the range holds whole is 'middle' with nothing inside it painting. */
export function classifyBlockForSelection(
	path: readonly number[],
	coverage: RangeCoverage
): BlockSelectionClass {
	const { start, end } = coverage.range;
	if (pathsEqual(start.path, end.path)) {
		return pathsEqual(path, start.path) ? 'single-block' : 'outside';
	}
	const root = coverage.rootHolding(path);
	if (root) return pathsEqual(root, path) ? 'middle' : 'outside';
	if (coverage.startEdge && pathsEqual(path, start.path)) return 'start';
	if (coverage.endEdge && pathsEqual(path, end.path)) return 'end';
	return 'outside';
}

/** Whether the block paints the range over its whole box, so a container's own decoration (an
 *  alert's badge), which no child host covers, is painted too; its children then paint nothing. */
export function blockPaintsWholeBox(
	path: readonly number[],
	coverage: RangeCoverage,
	wholeUnitPath: readonly number[] | null
): boolean {
	if (wholeUnitPath) return pathsEqual(path, wholeUnitPath);
	const { start, end } = coverage.range;
	if (pathsEqual(start.path, end.path)) return false;
	const root = coverage.rootHolding(path);
	return root !== null && pathsEqual(root, path);
}

/** The end-exclusive offsets an endpoint block measures its highlight between: a kept table
 *  edge's cells, or its text from the start or up to the end. */
export function endpointMeasureSpan(
	classification: BlockSelectionClass,
	coverage: RangeCoverage
): { from: number; to: number } {
	const { startEdge, endEdge, startCells, endCells } = coverage;
	const from = classification === 'end' ? 0 : (startCells?.from ?? textOffset(startEdge, 0));
	const to =
		classification === 'start'
			? SELECTION_END
			: (endCells?.to ?? textOffset(endEdge, SELECTION_END));
	return { from, to };
}

// A cell pair inside one table measures its rectangle, which reads no offset.
function textOffset(edge: SelectionPoint | null, fallback: number): number {
	return edge && !edge.cellCoordinate ? charOffsetOf(edge, 'endpointMeasureSpan') : fallback;
}
