/**
 * Pixel-X measurement for sticky column tracking. All coordinates are
 * editor-relative (viewport X minus editor container's viewport-left), so
 * values are invariant to vertical scrolling inside the editor.
 */

import type { StickyColumnDirection } from '../block-component';
import {
	asDomTextOffset,
	asViewportX,
	toEditorX,
	toViewportX,
	type DomTextOffset,
	type EditorX,
	type ViewportX
} from './coordinate-spaces';
import { containerRawLength, findRawOffsetTarget } from './widget-offset';

// A candidate counts as "on the probe line" when its rect overlaps the line band
// padded by half a line height on each side — wide enough to catch ascender/
// descender variation, narrow enough to exclude the neighbouring line.
const LINE_BAND_TOLERANCE = 0.5;

export function getCurrentCursorEditorRelativeX(el: HTMLElement): EditorX | null {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);

	let viewportX: ViewportX | null = null;
	const rects = range.getClientRects();
	if (rects.length > 0 && rects[0].height > 0) {
		viewportX = asViewportX(rects[0].left);
	}
	if (viewportX === null) {
		const br = range.getBoundingClientRect();
		if (br.height > 0 || br.width > 0) viewportX = asViewportX(br.left);
	}
	if (viewportX === null) {
		viewportX = asViewportX(el.getBoundingClientRect().left);
	}

	const editor = el.closest('.editor') as HTMLElement | null;
	const editorLeft = editor ? editor.getBoundingClientRect().left : 0;
	return toEditorX(viewportX, editorLeft);
}

export function getOffsetRect(container: HTMLElement, offset: DomTextOffset): DOMRect | null {
	const pos = findRawOffsetTarget(container, offset);
	if (!pos) return null;
	const range = document.createRange();
	try {
		range.setStart(pos.node, pos.offset);
	} catch {
		return null;
	}
	range.collapse(true);
	const rects = range.getClientRects();
	if (rects.length > 0 && rects[0].height > 0) return rects[0] as DOMRect;
	const br = range.getBoundingClientRect();
	if (br.height > 0 || br.width > 0) return br;
	return null;
}

/**
 * Offset on the first or last caret-bearing visual line whose collapsed-range
 * rect is closest to `editorRelativeX`. Linear scan: getClientRects left
 * values are non-monotonic on BiDi lines, so binary search is invalid.
 *
 * Widget-only lines are transparent here: collapsed ranges adjacent to a
 * contenteditable=false widget return null rects, so those offsets aren't
 * candidates and sticky-Up/Down naturally lands on the nearest text-bearing
 * line. `minOffset` excludes the ambient-marker prefix region.
 */
export function findOffsetNearestX(
	container: HTMLElement,
	editorRelativeX: EditorX,
	from: StickyColumnDirection,
	minOffset: DomTextOffset = asDomTextOffset(0)
): DomTextOffset {
	const totalLen = containerRawLength(container);
	if (totalLen <= minOffset) return minOffset;

	const editor = container.closest('.editor') as HTMLElement | null;
	const editorLeft = editor ? editor.getBoundingClientRect().left : 0;
	const targetViewportX = toViewportX(editorRelativeX, editorLeft);

	// Sticky-from-above lands on the FIRST visual line, sticky-from-below on the
	// LAST, so only offsets near that edge can be the answer. Walk inward from the
	// probed edge and stop a few lines past it — the band filter below discards
	// anything further regardless, so the result is identical to a full scan while
	// the work is O(lines-near-edge), not O(raw length). The scan stays linear
	// (BiDi makes per-line left values non-monotonic); only its range is bounded.
	const forward = from === 'above';
	const STOP_AFTER_LINES = 3;
	const candidates: { offset: DomTextOffset; rect: DOMRect }[] = [];
	let edgeExtreme = forward ? Infinity : -Infinity; // min top (above) / max bottom (below)
	let lineH = 0;
	for (let k = 0; k <= totalLen - minOffset; k++) {
		const offset = asDomTextOffset(forward ? minOffset + k : totalLen - k);
		const rect = getOffsetRect(container, offset);
		if (!rect) continue;
		if (lineH === 0) lineH = Math.max(1, rect.bottom - rect.top);
		if (candidates.length > 0) {
			const distancePastEdge = forward ? rect.top - edgeExtreme : edgeExtreme - rect.bottom;
			if (distancePastEdge > STOP_AFTER_LINES * lineH) break;
		}
		candidates.push({ offset, rect });
		edgeExtreme = forward ? Math.min(edgeExtreme, rect.top) : Math.max(edgeExtreme, rect.bottom);
	}
	if (candidates.length === 0) return minOffset;

	const lineProbe =
		from === 'above'
			? candidates.reduce((best, c) => (c.rect.top < best.top ? c.rect : best), candidates[0].rect)
			: candidates.reduce(
					(best, c) => (c.rect.bottom > best.bottom ? c.rect : best),
					candidates[0].rect
				);

	const lineTop = lineProbe.top;
	const lineBottom = lineProbe.bottom;
	const lineHeight = Math.max(1, lineBottom - lineTop);
	const tolerance = lineHeight * LINE_BAND_TOLERANCE;

	let bestOffset = candidates[0].offset;
	let bestDelta = Infinity;
	for (const { offset, rect } of candidates) {
		if (rect.top > lineBottom + tolerance) continue;
		if (rect.bottom < lineTop - tolerance) continue;
		const delta = Math.abs(rect.left - targetViewportX);
		if (delta < bestDelta) {
			bestDelta = delta;
			bestOffset = offset;
		}
	}

	return bestOffset;
}
