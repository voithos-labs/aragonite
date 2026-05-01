/**
 * Cursor / range / selection helpers for contenteditable text surfaces.
 */

export function createRangeFromOffsets(
	container: HTMLElement,
	start: number,
	end: number
): Range | null {
	const range = document.createRange();
	let charCount = 0;
	let startSet = false;

	function walk(node: Node): boolean {
		// Image widgets are atomic: their textContent contributes to the
		// content-offset ledger (preserves textContent === ambientPrefix + raw)
		// but the cursor never lands inside. Snap requested offsets to the
		// widget's leading or trailing edge.
		if (node.nodeType === Node.ELEMENT_NODE && (node as Element).matches?.('[data-image-widget]')) {
			const len = (node as Element).textContent?.length ?? 0;
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

export function setCursorOffset(container: HTMLElement, offset: number): void {
	const range = createRangeFromOffsets(container, offset, offset);
	if (!range) return;
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}

/**
 * Single source of truth for "DOM (node, offset) → content-offset" inside a
 * contenteditable. `Selection.toString()` skips text inside
 * contenteditable=false islands (ambient markers, image widgets) and is
 * unreliable when ranges cross them; `Range.toString()` on a prefix range
 * does not skip, so all readers funnel through this helper.
 */
function nodeOffsetToContent(container: HTMLElement, node: Node, offset: number): number {
	const preRange = document.createRange();
	preRange.selectNodeContents(container);
	try {
		preRange.setEnd(node, offset);
	} catch {
		return 0;
	}
	return preRange.toString().length;
}

/**
 * Returns the range START (anchor for forward selections). For the moving
 * endpoint during Shift+Arrow extension, use `getSelectionFocusOffset`.
 */
export function getCursorOffset(container: HTMLElement): number | null {
	if (document.activeElement !== container) return null;
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	return nodeOffsetToContent(container, range.startContainer, range.startOffset);
}

/**
 * Returns the moving endpoint of the selection (distinct from the anchor
 * when the user has extended a selection). Used by Shift+Arrow boundary
 * checks to decide whether the next extension crosses a block boundary.
 */
export function getSelectionFocusOffset(container: HTMLElement): number | null {
	if (document.activeElement !== container) return null;
	const sel = window.getSelection();
	if (!sel || sel.focusNode === null) return null;
	if (!container.contains(sel.focusNode)) return null;
	return nodeOffsetToContent(container, sel.focusNode, sel.focusOffset);
}

export function getSelectionOffsets(container: HTMLElement): { start: number; end: number } | null {
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed) return null;
	const range = sel.getRangeAt(0);
	return {
		start: nodeOffsetToContent(container, range.startContainer, range.startOffset),
		end: nodeOffsetToContent(container, range.endContainer, range.endOffset)
	};
}

export function hasSelection(): boolean {
	const sel = window.getSelection();
	return Boolean(sel && !sel.isCollapsed);
}
