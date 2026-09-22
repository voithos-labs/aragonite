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
	findDomTextOffsetTarget
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
	const pos = findDomTextOffsetTarget(container, offset);
	if (!pos) return null;
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
		offset: domTextOffsetAtNode(container, pos.node, pos.offset),
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

	// Only offsets near the probed edge can be the answer, so walk inward and stop a few
	// lines past it: the band filter below discards anything further regardless, making
	// this identical to a full scan at O(lines-near-edge) instead of O(raw length).
	const forward = from === 'above';
	const STOP_AFTER_LINES = 3;
	const candidates: CaretProbe[] = [];
	// The probed edge's own line, read off boxes of their own only: a caret beside a widget shows
	// nothing, so such a line neither becomes the edge nor cuts the walk short.
	let edge: CaretRect | null = null;
	let lineH = 0;
	for (let k = 0; k <= totalLen - minOffset; k++) {
		const probe = caretBoxAt(container, asDomTextOffset(forward ? minOffset + k : totalLen - k));
		if (!probe) continue;
		const rect = probe.rect;
		if (!probe.borrowed) {
			if (lineH === 0) lineH = Math.max(1, rect.bottom - rect.top);
			if (edge) {
				const distancePastEdge = forward ? rect.top - edge.top : edge.bottom - rect.bottom;
				if (distancePastEdge > STOP_AFTER_LINES * lineH) break;
			}
			if (!edge || (forward ? rect.top < edge.top : rect.bottom > edge.bottom)) edge = rect;
		}
		candidates.push(probe);
	}
	if (candidates.length === 0) return minOffset;

	// A block made of widgets alone has no line with a box of its own, and the widget edges are
	// the only positions its caret can take.
	const pool = edge ? candidates.filter((probe) => !probe.borrowed) : candidates;
	const edgeLine = edge ?? edgeLineOf(pool, forward);
	// Which offsets share the edge line: boxes ending within the block's own leading of it, so a
	// tall widget and the text beside it read as one line while the line above never does.
	const tolerance = sameLineTolerance(container);
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
