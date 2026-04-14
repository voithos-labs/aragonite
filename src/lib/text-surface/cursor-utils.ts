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

	walk(container);
	if (!startSet) {
		range.selectNodeContents(container);
		range.collapse(false);
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
 * Read the current selection's character offsets inside `container`, or null
 * if the selection is collapsed or not inside `container`.
 */
export function getSelectionOffsets(
	container: HTMLElement
): { start: number; end: number } | null {
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
