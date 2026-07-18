/**
 * Geometry-based visual-line detection. Determines whether the cursor sits
 * on the first or last visual line of a wrapping element.
 *
 * Offsets alone can't answer this on blocks that wrap across 3+ visual lines;
 * the cursor Y must be compared to the first/last line Y. The text-node walk
 * is the workaround for collapsed ranges next to non-text children (e.g.
 * dimmed `md-marker` spans) returning null rects from getClientRects —
 * measuring around a real text node always returns a valid rect.
 */

import { FALLBACK_LINE_HEIGHT } from './typography-estimates';

// Cursor counts as on the boundary line when its Y is within this fraction of a
// line height of the first/last line's Y — sub-line so sub/superscript or
// inline-image jitter on the same line doesn't read as a different line.
const SAME_LINE_TOLERANCE = 0.8;

export function getRangeTop(range: Range): number | null {
	const rects = range.getClientRects();
	if (rects.length > 0 && rects[0].height > 0) return rects[0].top;
	const br = range.getBoundingClientRect();
	if (br.height > 0) return br.top;
	return null;
}

/**
 * Non-collapsed ranges reliably return rects where collapsed ones don't —
 * this is the primary measurement primitive for isAt{First,Last}VisualLine.
 */
export function getCharRangeTop(container: Node, offset: number, atEnd: boolean): number | null {
	try {
		const range = document.createRange();
		if (atEnd) {
			range.setStart(container, Math.max(0, offset - 1));
			range.setEnd(container, offset);
		} else {
			range.setStart(container, offset);
			range.setEnd(container, offset + 1);
		}
		const rects = range.getClientRects();
		if (rects.length > 0 && rects[0].height > 0) return rects[0].top;
		const br = range.getBoundingClientRect();
		if (br.height > 0 || br.width > 0) return br.top;
	} catch {
		// offset out of bounds
	}
	return null;
}

/**
 * Skips non-text children (e.g. dimmed marker spans) that would cause
 * isAtFirstVisualLine to fail to measure the block's first line.
 */
export function findFirstTextNode(node: Node): Text | null {
	if (node.nodeType === Node.TEXT_NODE && (node.textContent?.length ?? 0) > 0) {
		return node as Text;
	}
	for (let i = 0; i < node.childNodes.length; i++) {
		const found = findFirstTextNode(node.childNodes[i]);
		if (found) return found;
	}
	return null;
}

export function findLastTextNode(node: Node): Text | null {
	if (node.nodeType === Node.TEXT_NODE && (node.textContent?.length ?? 0) > 0) {
		return node as Text;
	}
	for (let i = node.childNodes.length - 1; i >= 0; i--) {
		const found = findLastTextNode(node.childNodes[i]);
		if (found) return found;
	}
	return null;
}

/**
 * True if the selection inside `el` sits on the first visual line.
 * `fallbackOffset` is consulted when geometry measurement fails and should
 * be the cursor offset from getCursorOffset. Empty containers return true.
 *
 * `rangeCount === 0` means there's no live range to measure — Chromium drops
 * the caret range adjacent to atomic `contenteditable=false` islands across
 * event-loop yields. Resolve via `fallbackOffset` (the snapped caret intent
 * the caller reads through `ambient-cursor.getRaw`) rather than hard-false:
 * a hard-false would strand every subsequent boundary read at false once the
 * range drops. This mirrors the geometry-null branch below.
 */
export function isAtFirstVisualLine(el: HTMLElement, fallbackOffset: number): boolean {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return fallbackOffset === 0;
	if ((el.textContent ?? '').length === 0) return true;

	const cursorRange = sel.getRangeAt(0);
	const cursorTop = getRangeTop(cursorRange);

	if (cursorTop === null && cursorRange.collapsed) {
		if (fallbackOffset === 0) return true;
		return false;
	}
	if (cursorTop === null) return true;

	const firstText = findFirstTextNode(el);
	let startTop: number | null = null;
	if (firstText) {
		startTop = getCharRangeTop(firstText, 0, false);
	}
	if (startTop === null) {
		const startRange = document.createRange();
		startRange.selectNodeContents(el);
		startRange.collapse(true);
		startTop = getRangeTop(startRange);
	}
	if (startTop === null) {
		return fallbackOffset === 0;
	}

	const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || FALLBACK_LINE_HEIGHT;
	return Math.abs(cursorTop - startTop) < lineHeight * SAME_LINE_TOLERANCE;
}

export function isAtLastVisualLine(
	el: HTMLElement,
	fallbackOffset: number,
	textLen: number
): boolean {
	const sel = window.getSelection();
	// See isAtFirstVisualLine — a dropped range resolves via the snapped fallback.
	if (!sel || sel.rangeCount === 0) return fallbackOffset === textLen;
	if (textLen === 0) return true;

	const cursorRange = sel.getRangeAt(0);
	const cursorTop = getRangeTop(cursorRange);

	if (cursorTop === null && cursorRange.collapsed) {
		if (fallbackOffset === textLen) return true;
		return false;
	}
	if (cursorTop === null) return true;

	const lastText = findLastTextNode(el);
	let endTop: number | null = null;
	if (lastText) {
		const len = lastText.textContent!.length;
		endTop = getCharRangeTop(lastText, len, true);
	}
	if (endTop === null) {
		const endRange = document.createRange();
		endRange.selectNodeContents(el);
		endRange.collapse(false);
		endTop = getRangeTop(endRange);
	}
	if (endTop === null) {
		return fallbackOffset === textLen;
	}

	const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || FALLBACK_LINE_HEIGHT;
	return Math.abs(cursorTop - endTop) < lineHeight * SAME_LINE_TOLERANCE;
}
