/**
 * Pure cursor / range / selection helpers for contenteditable text surfaces.
 * Operates on HTMLElement + Range + Selection APIs directly — no Svelte
 * coupling, no editor state dependency. Extracted from TextEditableBlock.svelte.
 */

/**
 * Create a browser Range spanning character offsets [start, end) inside
 * `container`. Walks text node descendants counting characters. If `start`
 * or `end` is beyond the container's content length, clamps to the end.
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
		// End offset beyond content length — clamp to end of container.
		range.setEndAfter(container);
	}
	return range;
}

/** Place a collapsed cursor inside `container` at the given character offset. */
export function setCursorOffset(container: HTMLElement, offset: number): void {
	const range = createRangeFromOffsets(container, offset, offset);
	if (!range) return;
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}

/**
 * Read the current cursor's character offset inside `container`, or null
 * if the container is not the active element or no range exists.
 *
 * Returns the range START — the earlier endpoint of the selection in
 * document order, which equals the anchor for forward selections.
 * Callers that need the moving endpoint (e.g., Shift+Arrow boundary
 * checks) should use `getSelectionFocusOffset` instead.
 */
export function getCursorOffset(container: HTMLElement): number | null {
	if (document.activeElement !== container) return null;
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	const preRange = document.createRange();
	preRange.selectNodeContents(container);
	preRange.setEnd(range.startContainer, range.startOffset);
	return preRange.toString().length;
}

/**
 * Read the current selection's FOCUS offset inside `container`, or null
 * if `container` is not the active element or the focus is not inside it.
 *
 * The focus is where the caret is actively moving — distinct from the
 * range start (anchor) when the user has extended a selection. Used by
 * Shift+Arrow boundary checks to decide whether the next extension would
 * cross a block boundary based on where the caret currently is, not
 * where the selection originally started.
 */
export function getSelectionFocusOffset(container: HTMLElement): number | null {
	if (document.activeElement !== container) return null;
	const sel = window.getSelection();
	if (!sel || sel.focusNode === null) return null;
	if (!container.contains(sel.focusNode)) return null;
	const preRange = document.createRange();
	preRange.selectNodeContents(container);
	try {
		preRange.setEnd(sel.focusNode, sel.focusOffset);
	} catch {
		return null;
	}
	return preRange.toString().length;
}

/**
 * Read the current selection's character offsets inside `container`, or null
 * if the selection is collapsed or not inside `container`.
 */
export function getSelectionOffsets(container: HTMLElement): { start: number; end: number } | null {
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed) return null;
	const range = sel.getRangeAt(0);
	const preRange = document.createRange();
	preRange.selectNodeContents(container);
	preRange.setEnd(range.startContainer, range.startOffset);
	const start = preRange.toString().length;
	const end = start + sel.toString().length;
	return { start, end };
}

/** Returns true if a non-collapsed selection exists in the document. */
export function hasSelection(): boolean {
	const sel = window.getSelection();
	return Boolean(sel && !sel.isCollapsed);
}
