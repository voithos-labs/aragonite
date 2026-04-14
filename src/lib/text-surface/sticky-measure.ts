/**
 * Pixel-X measurement helpers for sticky column tracking. All coordinates
 * are editor-relative (viewport X minus the editor container's viewport-left),
 * so values are invariant to vertical scrolling inside the editor.
 *
 * Why linear scan in findOffsetNearestX: binary search on character offsets
 * is invalid on BiDi visual lines, where getClientRects() left values are
 * non-monotonic along logical offsets. Linear scan is O(n) in the block
 * length but the constant is small and this runs at most once per vertical
 * arrow keypress.
 */

import type { StickyColumnDirection } from '../editor-types';
import { createRangeFromOffsets } from './cursor-utils';

/**
 * Get the current cursor's editor-relative pixel X, or null if no usable
 * rect can be obtained. Requires `el` to contain the selection and to
 * have an ancestor with the `.editor` class.
 */
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

/** Get the DOMRect of a collapsed range at a specific character offset inside the container. */
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
 * Scan character offsets in the target visual line (first or last) and
 * return the offset whose Range left coordinate is closest to the target
 * editor-relative X. Linear scan for BiDi correctness.
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
