/**
 * Pixel-X measurement for sticky column tracking. All coordinates are
 * editor-relative (viewport X minus editor container's viewport-left), so
 * values are invariant to vertical scrolling inside the editor.
 */

import type { StickyColumnDirection } from '../block-component';
import { containerRawLength, findRawOffsetTarget } from './widget-offset';

// A candidate counts as "on the probe line" when its rect overlaps the line band
// padded by half a line height on each side — wide enough to catch ascender/
// descender variation, narrow enough to exclude the neighbouring line.
const LINE_BAND_TOLERANCE = 0.5;

export function getCurrentCursorEditorRelativeX(el: HTMLElement): number | null {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);

	let viewportX: number | null = null;
	const rects = range.getClientRects();
	if (rects.length > 0 && (rects[0].width >= 0 || rects[0].height > 0)) {
		viewportX = rects[0].left;
	}
	if (viewportX === null) {
		const br = range.getBoundingClientRect();
		if (br.height > 0 || br.width > 0) viewportX = br.left;
	}
	if (viewportX === null) {
		viewportX = el.getBoundingClientRect().left;
	}

	const editor = el.closest('.editor') as HTMLElement | null;
	const editorLeft = editor ? editor.getBoundingClientRect().left : 0;
	return viewportX - editorLeft;
}

export function getOffsetRect(container: HTMLElement, offset: number): DOMRect | null {
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
	editorRelativeX: number,
	from: StickyColumnDirection,
	minOffset = 0
): number {
	const totalLen = containerRawLength(container);
	if (totalLen <= minOffset) return minOffset;

	const editor = container.closest('.editor') as HTMLElement | null;
	const editorLeft = editor ? editor.getBoundingClientRect().left : 0;
	const targetViewportX = editorRelativeX + editorLeft;

	const candidates: { offset: number; rect: DOMRect }[] = [];
	for (let offset = minOffset; offset <= totalLen; offset++) {
		const rect = getOffsetRect(container, offset);
		if (rect) candidates.push({ offset, rect });
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
