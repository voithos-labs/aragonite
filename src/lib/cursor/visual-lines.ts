/**
 * Whether the cursor sits on the first or last visual line of a wrapping element. Offsets
 * alone can't answer it past 2 wrapped lines, so cursor Y is compared to the first/last
 * line's Y. The text-node walk works around collapsed ranges next to non-text children
 * (dimmed marker spans) returning null rects — measuring around real text always works.
 */

import { FALLBACK_LINE_HEIGHT } from './typography-estimates';
import { isHiddenMarkerText } from './widget-offset';

// Fraction of a line height within which the cursor Y counts as the boundary line —
// sub-line, so sub/superscript or inline-image jitter doesn't read as a different line.
const SAME_LINE_TOLERANCE = 0.8;

/**
 * The first rect that can position a caret: the leading client rect when it has real
 * height, else the bounding rect. `widthTolerant` also accepts a zero-height rect with
 * width; only `getRangeTop` passes false, keeping its test-pinned "null on a zero-height
 * rect" contract (behavior-neutral — its collapsed-caret inputs never produce that shape).
 */
export function firstUsefulRect(range: Range, widthTolerant = true): DOMRect | null {
	const rects = range.getClientRects();
	if (rects.length > 0 && rects[0].height > 0) return rects[0] as DOMRect;
	const br = range.getBoundingClientRect();
	if (br.height > 0 || (widthTolerant && br.width > 0)) return br;
	return null;
}

export function getRangeTop(range: Range): number | null {
	return firstUsefulRect(range, false)?.top ?? null;
}

/** Non-collapsed ranges reliably return rects where collapsed ones don't. */
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
		return firstUsefulRect(range)?.top ?? null;
	} catch {
		// offset out of bounds
	}
	return null;
}

/** Skips non-text children (dimmed marker spans) that would otherwise leave the block's
 *  first line unmeasurable, and hidden marker text, which measures to no rect at all. */
export function findFirstTextNode(root: Node): Text | null {
	return firstMeasurableText(root, containerOf(root));
}

export function findLastTextNode(root: Node): Text | null {
	return lastMeasurableText(root, containerOf(root));
}

/**
 * True if the selection inside `el` sits on the first visual line; empty containers return true.
 * `fallbackOffset` (the snapped caret intent from `ambient-cursor.getRaw`) resolves the case
 * where there is no live range — Chromium drops the caret range next to atomic
 * contenteditable=false islands across event-loop yields. It is compared against the block's
 * first LANDABLE offset, which a leading hidden run moves off raw 0.
 */
export function isAtFirstVisualLine(
	el: HTMLElement,
	fallbackOffset: number,
	contentStart: number
): boolean {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return fallbackOffset <= contentStart;
	if ((el.textContent ?? '').length === 0) return true;

	const cursorRange = sel.getRangeAt(0);
	const cursorTop = getRangeTop(cursorRange);

	if (cursorTop === null && cursorRange.collapsed) {
		return fallbackOffset <= contentStart;
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
		return fallbackOffset <= contentStart;
	}

	const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || FALLBACK_LINE_HEIGHT;
	return Math.abs(cursorTop - startTop) < lineHeight * SAME_LINE_TOLERANCE;
}

export function isAtLastVisualLine(
	el: HTMLElement,
	fallbackOffset: number,
	contentEnd: number
): boolean {
	const sel = window.getSelection();
	// See isAtFirstVisualLine — a dropped range resolves via the snapped fallback.
	if (!sel || sel.rangeCount === 0) return fallbackOffset >= contentEnd;
	if (contentEnd === 0) return true;

	const cursorRange = sel.getRangeAt(0);
	const cursorTop = getRangeTop(cursorRange);

	if (cursorTop === null && cursorRange.collapsed) {
		return fallbackOffset >= contentEnd;
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
		return fallbackOffset >= contentEnd;
	}

	const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || FALLBACK_LINE_HEIGHT;
	return Math.abs(cursorTop - endTop) < lineHeight * SAME_LINE_TOLERANCE;
}

// ── Internal ────────────────────────────────────────────────────────────────

/** Hidden-run classification needs the walk container; a bare text-node root has none. */
function containerOf(root: Node): HTMLElement | null {
	return root instanceof HTMLElement ? root : null;
}

function firstMeasurableText(node: Node, container: HTMLElement | null): Text | null {
	if (node.nodeType === Node.TEXT_NODE) {
		return isMeasurableText(node as Text, container) ? (node as Text) : null;
	}
	for (let i = 0; i < node.childNodes.length; i++) {
		const found = firstMeasurableText(node.childNodes[i], container);
		if (found) return found;
	}
	return null;
}

function lastMeasurableText(node: Node, container: HTMLElement | null): Text | null {
	if (node.nodeType === Node.TEXT_NODE) {
		return isMeasurableText(node as Text, container) ? (node as Text) : null;
	}
	for (let i = node.childNodes.length - 1; i >= 0; i--) {
		const found = lastMeasurableText(node.childNodes[i], container);
		if (found) return found;
	}
	return null;
}

function isMeasurableText(text: Text, container: HTMLElement | null): boolean {
	if ((text.textContent?.length ?? 0) === 0) return false;
	return container === null || !isHiddenMarkerText(text, container);
}
