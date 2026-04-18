/**
 * Geometry-based visual-line detection for contenteditable text surfaces.
 * Determines whether the cursor sits on the first or last visual line of a
 * wrapping element — used by arrow-key navigation to decide when to cross
 * a block boundary.
 *
 * Why geometry rather than offsets: multi-line blocks (paragraphs that wrap
 * across 3+ visual lines, headings with soft-wrapping content) cannot be
 * judged by offset alone. The cursor's Y coordinate must be compared to
 * the first/last line's Y to decide "am I on the first visual line."
 *
 * Why the text-node walk: collapsed ranges at the start or end of a
 * contenteditable that begins or ends with a non-text element (like a
 * dimmed `<span class="md-marker">##</span>` prefix in headings) can
 * return null rects from getClientRects. Walking to the first or last
 * *text node* and measuring a one-character range around it always
 * returns a valid rect as long as any text content exists.
 */

/** Get the vertical position (top) of a Range, handling null-rect edge cases. */
export function getRangeTop(range: Range): number | null {
	const rects = range.getClientRects();
	if (rects.length > 0 && rects[0].height > 0) return rects[0].top;
	const br = range.getBoundingClientRect();
	if (br.height > 0) return br.top;
	return null;
}

/**
 * Get the vertical position of a non-collapsed range around a character.
 * Non-collapsed ranges reliably return rects; this is the primary
 * measurement primitive for isAtFirstVisualLine / isAtLastVisualLine.
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
 * Find the first descendant text node with non-empty content. Used to
 * bypass dimmed-marker element children that would otherwise cause
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

/** Symmetric counterpart to findFirstTextNode. */
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
 * True if the current selection inside `el` sits on the first visual line.
 * `fallbackOffset` is consulted when geometry measurement fails (e.g.
 * transient layout states or collapsed ranges that return null rects) —
 * should be the cursor offset from getCursorOffset. Returns true for
 * empty containers.
 */
export function isAtFirstVisualLine(el: HTMLElement, fallbackOffset: number): boolean {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return true;
	if ((el.textContent ?? '').length === 0) return true;

	const cursorRange = sel.getRangeAt(0);
	let cursorTop = getRangeTop(cursorRange);

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

	const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
	return Math.abs(cursorTop - startTop) < lineHeight * 0.8;
}

/** Symmetric counterpart. `textLen` is the block's full textContent length. */
export function isAtLastVisualLine(
	el: HTMLElement,
	fallbackOffset: number,
	textLen: number
): boolean {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return true;
	if (textLen === 0) return true;

	const cursorRange = sel.getRangeAt(0);
	let cursorTop = getRangeTop(cursorRange);

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

	const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
	return Math.abs(cursorTop - endTop) < lineHeight * 0.8;
}
