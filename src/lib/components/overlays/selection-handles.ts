/**
 * Where a touch screen's selection handles stand, and the drag a handle starts. A finger's range is
 * always the editor's, so the handles stand at both ends of the range the editor paints and no
 * phone draws its own. See `docs/design/selection.md` § Cross-block selection.
 */

import type { EditorRects } from '../../editor-rects';
import type { UserScrollport } from '../../windowing/scroll-ancestors';
import type { BlockElLookup } from '../../caret/block-el-lookup';
import type { CaretWriter } from '../../browser/caret-writer';
import type { SelectionState } from '../../selection/selection-state.svelte';
import { normalize, type SelectionEndpoint, type SelectionPoint } from '../../selection/primitives';
import { installDragListener } from '../../selection/drag-pointer';
import { pathsEqual } from '../../selection/path-math';
import { fingerPress, type FingerPress } from '../../selection/pointer-gesture';
import { cellDragFrom, installCellDragListener } from '../blocks/table/cell-pointer';

export type HandleEnd = 'start' | 'end';

/** The painted range the handles stand on, in document order. */
export interface HandleRange {
	start: SelectionPoint;
	end: SelectionPoint;
}

/** One handle, in viewport coordinates. */
export interface HandleSpot {
	end: HandleEnd;
	/** The text point the handle drags: the end's line, at its middle. */
	x: number;
	y: number;
	/** The end's line box. */
	top: number;
	bottom: number;
}

type Rects = Pick<EditorRects, 'rangeRects' | 'blockRect'>;

/** The range the editor paints, or null while it paints none. */
export function handleRange(selection: SelectionState): HandleRange | null {
	if (!selection.isCustomRendered || !selection.start || !selection.end) return null;
	return { start: selection.start, end: selection.end };
}

/** The cell a cell end sits in (`SelectionState.cellLandingFor`), where its handle stands. */
export type CellPathOf = (point: SelectionPoint) => number[];

export function handleSpots(
	range: HandleRange | null,
	rects: Rects,
	cellPath: CellPathOf
): HandleSpot[] {
	if (!range) return [];
	const ends: [HandleEnd, SelectionPoint][] = [
		['start', range.start],
		['end', range.end]
	];
	return ends.flatMap(([side, point]) => {
		const line = lineAt(rects, point, side, cellPath);
		return line ? [{ end: side, ...line }] : [];
	});
}

/** Everything a handle's drag runs on. */
export interface HandleDragDeps {
	editorRoot: HTMLElement;
	scrollContainer: UserScrollport;
	selection: SelectionState;
	caretWriter: CaretWriter;
	getBlockElByPath: BlockElLookup;
	/** A block's caret bounds (`BlockComponent.caretBounds`), where a rectangle's fixed corner is. */
	caretBounds(path: number[]): { start: number; end: number } | null;
	lifetimeSignal: AbortSignal;
}

/** Drags `grabbed` with the range's other end as the anchor: a cell rectangle while that end sits
 *  in a table cell, the ordinary range otherwise, the same drags a press starts. */
export function startHandleDrag(
	down: PointerEvent,
	grabbed: HandleSpot,
	range: HandleRange,
	deps: HandleDragDeps
): void {
	const fixed = fixedEnd(grabbed.end, deps.selection, fingerPress(down));
	if (!fixed) return;
	const offset = { clientX: grabbed.x - down.clientX, clientY: grabbed.y - down.clientY };
	const from =
		'offset' in fixed && fixed.cellCoordinate ? cellText(fixed, grabbed.end, deps) : fixed;
	const blockEl = from && deps.getBlockElByPath(from.path);
	const cell = blockEl && from && 'offset' in from ? cellDragFrom(blockEl, from) : null;
	if (cell) {
		installCellDragListener({ ...deps, touch: 'own', offset }, cell.anchor, down, cell.padding);
		return;
	}
	installDragListener({ ...deps, touch: 'own', offset, paintSameBlock: () => true }, fixed, down);
}

const other = (end: HandleEnd): HandleEnd => (end === 'start' ? 'end' : 'start');

// A rectangle's fixed corner as the edge of its cell's text facing the range, so a drag back into
// that cell selects from there as a press in the cell would.
function cellText(
	corner: SelectionPoint,
	grabbed: HandleEnd,
	deps: Pick<HandleDragDeps, 'selection' | 'caretBounds'>
): SelectionPoint | null {
	const { path } = deps.selection.cellLandingFor(corner);
	const bounds = deps.caretBounds(path);
	if (!bounds) return null;
	return { path, offset: grabbed === 'end' ? bounds.start : bounds.end };
}

// A drag moves the stored range's focus, so a grabbed anchor first trades places with the focus,
// a range inside one block keeping it the editor's. A block held whole is re-entered by the drag.
function fixedEnd(
	grabbed: HandleEnd,
	selection: SelectionState,
	press: FingerPress | null
): SelectionEndpoint | null {
	const { anchor, focus } = selection;
	const whole = selection.wholeUnitPath;
	if (!anchor || !focus) return null;
	if (whole) return { path: whole, wholeBlock: true };
	const ordered = normalize({ anchor, focus });
	const fixed = ordered[other(grabbed)];
	if (fixed === anchor) return fixed;
	if (press && pathsEqual(fixed.path, ordered[grabbed].path))
		selection.ownBlockRange(fixed, ordered[grabbed], press);
	else selection.enterCrossBlock(fixed, ordered[grabbed]);
	return fixed;
}

// ── Measuring ──────────────────────────────────────────────────────────────

// A cell end takes its cell's corner, a text end the side of the character it borders, and an end
// with no character there (a block held whole, an empty block) its block's box.
function lineAt(
	rects: Rects,
	point: SelectionPoint,
	side: HandleEnd,
	cellPath: (point: SelectionPoint) => number[]
): Pick<HandleSpot, 'x' | 'y' | 'top' | 'bottom'> | null {
	const { path, offset } = point;
	if (point.cellCoordinate) return boxSide(rects.blockRect(cellPath(point)) ?? undefined, side);
	const after = rects.rangeRects(path, offset, offset + 1)[0];
	const before = offset > 0 ? rects.rangeRects(path, offset - 1, offset).at(-1) : undefined;
	const char = side === 'end' ? (before ?? after) : (after ?? before);
	if (!char) return boxSide(rects.blockRect(path) ?? undefined, side);
	const x = char === before ? char.right : char.left;
	return { x, y: (char.top + char.bottom) / 2, top: char.top, bottom: char.bottom };
}

function boxSide(
	box: DOMRect | undefined,
	side: HandleEnd
): Pick<HandleSpot, 'x' | 'y' | 'top' | 'bottom'> | null {
	if (!box) return null;
	return {
		x: side === 'start' ? box.left : box.right,
		y: (box.top + box.bottom) / 2,
		top: box.top,
		bottom: box.bottom
	};
}
