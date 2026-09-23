/**
 * Pixel-X measurement for sticky column tracking. Coordinates are editor-relative, so
 * values are invariant to vertical scrolling inside the editor.
 */

import type { StickyColumnDirection } from '../block-component';
import {
	asDomTextOffset,
	asViewportX,
	toEditorX,
	toViewportX,
	type DomTextOffset,
	type EditorX
} from './coordinate-spaces';
import {
	containerDomTextLength,
	domTextOffsetAtNode,
	findDomTextLanding,
	holdsTextPast,
	widgetSpanContainingOffset
} from './widget-offset';
import {
	firstUsefulRect,
	neighbourCaretRect,
	sameLineTolerance,
	type CaretRect
} from './visual-lines';

export function getCurrentCursorEditorRelativeX(el: HTMLElement): EditorX | null {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);

	const rect = firstUsefulRect(range) ?? neighbourCaretRect(range);
	const viewportX = asViewportX(rect ? rect.left : el.getBoundingClientRect().left);
	return toEditorX(viewportX, editorLeftOf(el));
}

export interface CaretProbe {
	offset: DomTextOffset;
	rect: CaretRect;
	/** The position has no box of its own and borrowed the neighbouring widget's, so nothing
	 *  paints a caret there: a landing of last resort. */
	borrowed: boolean;
}

/**
 * The caret's box at a DOM-walk offset, under the offset the caret would really take: an offset
 * inside an atomic widget resolves to the position beside it, which names that widget's boundary.
 * A position beside a widget has no box of its own and borrows the widget's near edge. Null where
 * the offset measures to nothing.
 */
export function caretBoxAt(container: HTMLElement, offset: DomTextOffset): CaretProbe | null {
	const landing = findDomTextLanding(container, offset);
	if (!landing) return null;
	const pos = landing.position;
	const range = document.createRange();
	try {
		range.setStart(pos.node, pos.offset);
	} catch {
		return null;
	}
	range.collapse(true);
	const measured = firstUsefulRect(range);
	const rect = measured ?? neighbourCaretRect(range);
	if (!rect) return null;
	return {
		offset: landing.inTextAtTarget ? offset : domTextOffsetAtNode(container, pos.node, pos.offset),
		rect,
		borrowed: measured === null
	};
}

/**
 * Offset on the first or last caret-bearing visual line whose caret box is closest to
 * `editorRelativeX`. A linear scan, since `getClientRects` left values are non-monotonic on BiDi
 * lines and binary search would be wrong. `minOffset` and `maxOffset` bound the landing: the
 * container's marker prefix is out by default, and a caller adds the lines a caret may not land
 * on (a code block's fences).
 */
export function findOffsetNearestX(
	container: HTMLElement,
	editorRelativeX: EditorX,
	from: StickyColumnDirection,
	minOffset: DomTextOffset = asDomTextOffset(0),
	maxOffset?: DomTextOffset
): DomTextOffset {
	const totalLen = Math.min(maxOffset ?? Infinity, containerDomTextLength(container));
	if (totalLen <= minOffset) return minOffset;

	const targetViewportX = toViewportX(editorRelativeX, editorLeftOf(container));

	// Only offsets near the probed edge can be the answer, so walk inward and stop past it: the
	// band filter below discards anything further regardless.
	const forward = from === 'above';
	const tolerance = sameLineTolerance(container);
	const owned = createEdgeTracker(forward, (first) => STOP_AFTER_LINES * lineHeightOf(first));
	// A caret beside a widget shows nothing, so a borrowed box sets the edge only in a block made
	// of widgets alone, where offsets run line by line and the walk can stop past the edge's band.
	const borrowed = holdsTextPast(container, minOffset)
		? null
		: createEdgeTracker(forward, () => tolerance);
	const walkEndsAt = (probe: CaretProbe): boolean => {
		if (!probe.borrowed) return owned.passes(probe.rect);
		// Once text has set the edge, a widget box as far past it ends the walk as a text box would.
		return owned.edge ? owned.isPast(probe.rect) : (borrowed?.passes(probe.rect) ?? false);
	};
	const candidates: CaretProbe[] = [];
	for (let k = 0; k <= totalLen - minOffset; k++) {
		const target = asDomTextOffset(forward ? minOffset + k : totalLen - k);
		// Every offset inside a widget lands beside it, where one of its boundaries measures: skip
		// to the far boundary so the widget costs one probe.
		const inside = widgetSpanContainingOffset(container, target);
		if (inside) {
			k = (forward ? inside.end - minOffset : totalLen - inside.start) - 1;
			continue;
		}
		const probe = caretBoxAt(container, target);
		if (!probe) continue;
		if (walkEndsAt(probe)) break;
		candidates.push(probe);
	}
	if (candidates.length === 0) return minOffset;

	// A block made of widgets alone has no line with a box of its own, and the widget edges are
	// the only positions its caret can take.
	const pool = owned.edge ? candidates.filter((probe) => !probe.borrowed) : candidates;
	const edgeLine = owned.edge ?? edgeLineOf(pool, forward);
	// Which offsets share the edge line: boxes ending within four fifths of the block's line
	// height of it, which holds a tall widget on the line with a few pixels to spare over the gap.
	let bestOffset = pool[0].offset;
	let bestDelta = Infinity;
	for (const { offset, rect } of pool) {
		if (Math.abs(rect.bottom - edgeLine.bottom) > tolerance) continue;
		const delta = Math.abs(rect.left - targetViewportX);
		if (delta < bestDelta) {
			bestDelta = delta;
			bestOffset = offset;
		}
	}

	return bestOffset;
}

// ── Internal ─────────────────────────────────────────────────────────────────

const STOP_AFTER_LINES = 3;

/** The probed edge's line as a walk inward sees it, and whether a box has gone further past it
 *  than `allowance` (read off the first box) lets the walk continue. Distances are between
 *  bottoms, the edge the band filter compares. */
function createEdgeTracker(forward: boolean, allowance: (first: CaretRect) => number) {
	let edge: CaretRect | null = null;
	let limit = 0;
	const isPast = (rect: CaretRect): boolean => {
		if (!edge) return false;
		return (forward ? rect.bottom - edge.bottom : edge.bottom - rect.bottom) > limit;
	};
	return {
		get edge() {
			return edge;
		},
		/** Reads the box against the edge without letting it move the edge. */
		isPast,
		/** Takes the box as the edge when it is the first, or sits nearer the edge than it. */
		passes(rect: CaretRect): boolean {
			if (!edge) {
				edge = rect;
				limit = allowance(rect);
				return false;
			}
			if (isPast(rect)) return true;
			if (forward ? rect.top < edge.top : rect.bottom > edge.bottom) edge = rect;
			return false;
		}
	};
}

function lineHeightOf(rect: CaretRect): number {
	return Math.max(1, rect.bottom - rect.top);
}

/** The box on the probed edge's line: the highest top (above) or the lowest bottom (below), the
 *  first of equals winning. */
function edgeLineOf(probes: CaretProbe[], forward: boolean): CaretRect {
	return probes.reduce(
		(held, probe) =>
			(forward ? probe.rect.top < held.top : probe.rect.bottom > held.bottom) ? probe.rect : held,
		probes[0].rect
	);
}

function editorLeftOf(el: HTMLElement): number {
	const editor = el.closest('.editor') as HTMLElement | null;
	return editor ? editor.getBoundingClientRect().left : 0;
}
