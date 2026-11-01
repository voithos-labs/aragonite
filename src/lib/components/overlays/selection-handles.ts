/**
 * Where a touch screen's selection handles stand, and the drag a handle starts. The editor's
 * handles stand only where the browser's can't reach: both ends of a range the editor paints, and
 * an end of a range inside one block that sits at the block's edge, which the browser's own handle
 * can't drag past. See `docs/design/selection.md` § Cross-block selection.
 */

import type { EditorRects } from '../../editor-rects';
import type { UserScrollport } from '../../windowing/scroll-ancestors';
import type { BlockElLookup } from '../../caret/block-el-lookup';
import type { CaretWriter } from '../../browser/caret-writer';
import type { SelectionState } from '../../selection/selection-state.svelte';
import { normalize, type SelectionEndpoint, type SelectionPoint } from '../../selection/primitives';
import { installDragListener } from '../../selection/drag-pointer';
import { readDomPoint } from '../../selection/native-bridge';
import { pathsEqual } from '../../selection/path-math';
import { readNativeSelection } from '../../browser/selection-read';
import { cellDragFrom, installCellDragListener } from '../blocks/table/cell-pointer';

export type HandleEnd = 'start' | 'end';

/** A range in document order and whether the editor paints it (across blocks, a cell rectangle, a
 *  block held whole) rather than the browser. */
export interface HandleRange {
	start: SelectionPoint;
	end: SelectionPoint;
	painted: boolean;
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
	/** Beside the browser's own handle at a block's edge, rather than under the point. */
	edge: boolean;
}

type Rects = Pick<EditorRects, 'rangeRects' | 'blockRect'>;

/** The range the handles stand on: the editor's while it paints one, otherwise the browser's own,
 *  read off the native selection rather than the focused block, since a menu can hold focus. */
export function handleRange(selection: SelectionState, root: HTMLElement): HandleRange | null {
	if (selection.isCustomRendered && selection.start && selection.end) {
		return { start: selection.start, end: selection.end, painted: true };
	}
	const live = readNativeSelection();
	if (!live || live.collapsed) return null;
	const anchor = readDomPoint(root, live.anchor.node, live.anchor.offset);
	const focus = readDomPoint(root, live.focus.node, live.focus.offset);
	if (!anchor || !focus || !pathsEqual(anchor.path, focus.path)) return null;
	return { ...normalize({ anchor, focus }), painted: false };
}

/** What the spots read besides the rects: the cell a cell end sits in
 *  (`SelectionState.cellLandingFor`), and a block's caret bounds (`BlockComponent.caretBounds`). */
export interface HandleReads {
	cellPath(point: SelectionPoint): number[];
	caretBounds(path: number[]): { start: number; end: number } | null;
}

export function handleSpots(
	range: HandleRange | null,
	rects: Rects,
	reads: HandleReads
): HandleSpot[] {
	if (!range) return [];
	const { start, end } = range;
	if (!range.painted && !(start.offset < end.offset)) return [];
	const ends: [HandleEnd, SelectionPoint, boolean][] = range.painted
		? [
				['start', start, true],
				['end', end, true]
			]
		: [
				['start', start, start.offset <= (reads.caretBounds(start.path)?.start ?? -1)],
				['end', end, end.offset >= (reads.caretBounds(end.path)?.end ?? Infinity)]
			];
	return ends.flatMap(([side, point, stands]) => {
		const line = stands ? lineAt(rects, point, side, reads.cellPath) : null;
		return line ? [{ end: side, ...line, edge: !range.painted }] : [];
	});
}

/** Everything a handle's drag runs on. */
export interface HandleDragDeps {
	editorRoot: HTMLElement;
	scrollContainer: UserScrollport;
	selection: SelectionState;
	caretWriter: CaretWriter;
	getBlockElByPath: BlockElLookup;
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
	const fixed = range.painted
		? fixedPaintedEnd(grabbed.end, deps.selection)
		: range[other(grabbed.end)];
	if (!fixed) return;
	const offset = { clientX: grabbed.x - down.clientX, clientY: grabbed.y - down.clientY };
	const blockEl = deps.getBlockElByPath(fixed.path);
	const cell = blockEl && 'offset' in fixed ? cellDragFrom(blockEl, fixed) : null;
	if (cell) {
		installCellDragListener({ ...deps, touch: 'own', offset }, cell.anchor, down, cell.padding);
		return;
	}
	installDragListener({ ...deps, touch: 'own', offset, paintSameBlock: () => true }, fixed, down);
}

const other = (end: HandleEnd): HandleEnd => (end === 'start' ? 'end' : 'start');

// A drag moves the stored range's focus, so a grabbed anchor first trades places with the focus.
// A block held whole is re-entered by the drag itself, from the block as a whole.
function fixedPaintedEnd(grabbed: HandleEnd, selection: SelectionState): SelectionEndpoint | null {
	const { anchor, focus } = selection;
	const whole = selection.wholeUnitPath;
	if (!anchor || !focus) return null;
	if (whole) return { path: whole, wholeBlock: true };
	const ordered = normalize({ anchor, focus });
	const fixed = ordered[other(grabbed)];
	if (fixed !== anchor) selection.enterCrossBlock(fixed, ordered[grabbed]);
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
