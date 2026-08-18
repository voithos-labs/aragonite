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

/** The first rect that can position a caret: the leading client rect when it has real
 *  height, else the bounding rect. `widthTolerant` also accepts a zero-height rect with width. */
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
	return measurableText(root, containerOf(root), false);
}

export function findLastTextNode(root: Node): Text | null {
	return measurableText(root, containerOf(root), true);
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
	return isAtEdgeVisualLine(el, () => fallbackOffset <= contentStart, {
		isEmpty: (el.textContent ?? '').length === 0,
		boundaryTop: () => {
			const firstText = findFirstTextNode(el);
			const top = firstText ? getCharRangeTop(firstText, 0, false) : null;
			return top ?? collapsedContentsTop(el, true);
		}
	});
}

export function isAtLastVisualLine(
	el: HTMLElement,
	fallbackOffset: number,
	contentEnd: number
): boolean {
	return isAtEdgeVisualLine(el, () => fallbackOffset >= contentEnd, {
		isEmpty: contentEnd === 0,
		boundaryTop: () => {
			const lastText = findLastTextNode(el);
			const top = lastText ? getCharRangeTop(lastText, lastText.textContent!.length, true) : null;
			return top ?? collapsedContentsTop(el, false);
		}
	});
}

// ── Internal ────────────────────────────────────────────────────────────────

/** The shared skeleton of the two edge predicates: `fallback` answers where geometry cannot — a
 *  dropped range, an unmeasurable collapsed caret, an unmeasurable boundary line — and
 *  `boundaryTop` measures the edge line each side's own way. */
function isAtEdgeVisualLine(
	el: HTMLElement,
	fallback: () => boolean,
	edge: { isEmpty: boolean; boundaryTop: () => number | null }
): boolean {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return fallback();
	if (edge.isEmpty) return true;

	const cursorRange = sel.getRangeAt(0);
	const cursorTop = getRangeTop(cursorRange);
	if (cursorTop === null) return cursorRange.collapsed ? fallback() : true;

	const edgeTop = edge.boundaryTop();
	if (edgeTop === null) return fallback();

	const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || FALLBACK_LINE_HEIGHT;
	return Math.abs(cursorTop - edgeTop) < lineHeight * SAME_LINE_TOLERANCE;
}

/** The boundary line's collapsed-contents fallback measurement. */
function collapsedContentsTop(el: HTMLElement, toStart: boolean): number | null {
	const range = document.createRange();
	range.selectNodeContents(el);
	range.collapse(toStart);
	return getRangeTop(range);
}

/** Hidden-run classification needs the walk container; a bare text-node root has none. */
function containerOf(root: Node): HTMLElement | null {
	return root instanceof HTMLElement ? root : null;
}

function measurableText(node: Node, container: HTMLElement | null, fromEnd: boolean): Text | null {
	if (node.nodeType === Node.TEXT_NODE) {
		return isMeasurableText(node as Text, container) ? (node as Text) : null;
	}
	const children = node.childNodes;
	for (let i = 0; i < children.length; i++) {
		const child = children[fromEnd ? children.length - 1 - i : i];
		const found = measurableText(child, container, fromEnd);
		if (found) return found;
	}
	return null;
}

function isMeasurableText(text: Text, container: HTMLElement | null): boolean {
	if ((text.textContent?.length ?? 0) === 0) return false;
	return container === null || !isHiddenMarkerText(text, container);
}
