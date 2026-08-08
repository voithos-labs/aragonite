/**
 * Cursor / range / selection helpers for contenteditable text surfaces. Offsets count DOM
 * text characters ambient-inclusively (`Range.toString()` does not skip
 * contenteditable=false islands), so they are `DomTextOffset`. An offset inside a span the
 * cursor may not enter — an atomic inline widget, or marker text the mode hides — snaps to
 * that span's leading or trailing edge.
 */

import { asDomTextOffset, type DomTextOffset } from './coordinate-spaces';
import { isHiddenMarkerRoot } from './widget-offset';

/**
 * Length of a span the cursor may not enter, or null when it is transparent. Atomic widgets
 * and marker text the mode paints nothing for are both opaque: an offset inside either has
 * no position to seat, and hiding is classified at its one home, never re-derived here.
 */
function opaqueSpanLength(node: Node, container: HTMLElement): number | null {
	if (node.nodeType !== Node.ELEMENT_NODE) return null;
	const el = node as Element;
	if (!el.matches?.('[data-inline-widget]') && !isHiddenMarkerRoot(el, container)) return null;
	return el.textContent?.length ?? 0;
}

export function createRangeFromOffsets(
	container: HTMLElement,
	start: DomTextOffset,
	end: DomTextOffset
): Range | null {
	const range = document.createRange();
	let charCount = 0;
	let startSet = false;

	function walk(node: Node): boolean {
		// The cursor never lands inside an opaque span: snap to the nearer edge.
		const len = opaqueSpanLength(node, container);
		if (len !== null) {
			if (!startSet && start <= charCount + len) {
				if (start <= charCount) range.setStartBefore(node);
				else range.setStartAfter(node);
				startSet = true;
			}
			if (startSet && end <= charCount + len) {
				if (end <= charCount) range.setEndBefore(node);
				else range.setEndAfter(node);
				return true;
			}
			charCount += len;
			return false;
		}
		if (node.nodeType === Node.TEXT_NODE) {
			const len = node.textContent?.length ?? 0;
			if (!startSet && charCount + len >= start) {
				range.setStart(node, start - charCount);
				startSet = true;
			}
			if (startSet && charCount + len >= end) {
				range.setEnd(node, end - charCount);
				return true;
			}
			charCount += len;
		} else {
			for (const child of node.childNodes) {
				if (walk(child)) return true;
			}
		}
		return false;
	}

	const endFound = walk(container);
	if (!startSet) {
		range.selectNodeContents(container);
		range.collapse(false);
	} else if (!endFound) {
		range.setEndAfter(container);
	}
	return range;
}

export function setCursorOffset(container: HTMLElement, offset: DomTextOffset): void {
	const range = createRangeFromOffsets(container, offset, offset);
	if (!range) return;
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}

/**
 * The one "DOM (node, offset) → content-offset" read here. `Selection.toString()` skips
 * text inside contenteditable=false islands and is unreliable across them; `Range.toString()`
 * on a prefix range does not skip, so all readers funnel through this.
 */
function nodeOffsetToContent(container: HTMLElement, node: Node, offset: number): DomTextOffset {
	const preRange = document.createRange();
	preRange.selectNodeContents(container);
	try {
		preRange.setEnd(node, offset);
	} catch {
		return asDomTextOffset(0);
	}
	return asDomTextOffset(preRange.toString().length);
}

/** The range START (anchor for forward selections); the moving endpoint during Shift+Arrow
 *  extension is `getSelectionFocusOffset`. */
export function getCursorOffset(container: HTMLElement): DomTextOffset | null {
	if (document.activeElement !== container) return null;
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	return nodeOffsetToContent(container, range.startContainer, range.startOffset);
}

/** The moving endpoint of the selection, distinct from the anchor once extended. */
export function getSelectionFocusOffset(container: HTMLElement): DomTextOffset | null {
	if (document.activeElement !== container) return null;
	const sel = window.getSelection();
	if (!sel || sel.focusNode === null) return null;
	if (!container.contains(sel.focusNode)) return null;
	return nodeOffsetToContent(container, sel.focusNode, sel.focusOffset);
}

export function getSelectionOffsets(
	container: HTMLElement
): { start: DomTextOffset; end: DomTextOffset } | null {
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed) return null;
	return getRangeOffsets(container, sel.getRangeAt(0));
}

/**
 * Offsets for an arbitrary range inside `container` — an InputEvent's `getTargetRanges()`
 * pending-edit range is not the live selection (a word delete at a collapsed caret reports
 * the whole word). Null when either endpoint sits outside the container.
 */
export function getRangeOffsets(
	container: HTMLElement,
	range: AbstractRange
): { start: DomTextOffset; end: DomTextOffset } | null {
	if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
		return null;
	}
	return {
		start: nodeOffsetToContent(container, range.startContainer, range.startOffset),
		end: nodeOffsetToContent(container, range.endContainer, range.endOffset)
	};
}

export function hasSelection(): boolean {
	const sel = window.getSelection();
	return Boolean(sel && !sel.isCollapsed);
}
