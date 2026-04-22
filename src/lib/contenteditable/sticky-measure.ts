/**
 * Pixel-X measurement for sticky column tracking. All coordinates are
 * editor-relative (viewport X minus editor container's viewport-left), so
 * values are invariant to vertical scrolling inside the editor.
 */

import type { StickyColumnDirection } from '../contracts';
import { createRangeFromOffsets } from './cursor-utils';

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
	const range = createRangeFromOffsets(container, offset, offset);
	if (!range) return null;
	const rects = range.getClientRects();
	if (rects.length > 0 && rects[0].height > 0) return rects[0] as DOMRect;
	const br = range.getBoundingClientRect();
	if (br.height > 0 || br.width > 0) return br;
	return null;
}

/**
 * Returns the offset in the target visual line (first or last) whose Range
 * left coordinate is closest to the target X. Linear scan because
 * getClientRects left values are non-monotonic along logical offsets on BiDi
 * lines, so binary search is invalid.
 */
export function findOffsetNearestX(
	container: HTMLElement,
	editorRelativeX: number,
	from: StickyColumnDirection
): number {
	const text = container.textContent ?? '';
	const textLen = text.length;
	if (textLen === 0) return 0;

	const editor = container.closest('.editor') as HTMLElement | null;
	const editorLeft = editor ? editor.getBoundingClientRect().left : 0;
	const targetViewportX = editorRelativeX + editorLeft;

	const probeOffset = from === 'above' ? 0 : textLen;
	const probeRect = getOffsetRect(container, probeOffset);
	if (!probeRect) return probeOffset;

	const lineTop = probeRect.top;
	const lineBottom = probeRect.bottom;
	const lineHeight = Math.max(1, lineBottom - lineTop);
	const tolerance = lineHeight * 0.5;

	let bestOffset = probeOffset;
	let bestDelta = Math.abs(probeRect.left - targetViewportX);

	for (let offset = 0; offset <= textLen; offset++) {
		const rect = getOffsetRect(container, offset);
		if (!rect) continue;
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
