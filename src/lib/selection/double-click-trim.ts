/**
 * Word selection without its trailing space. Windows Chromium's double-click takes the whitespace
 * after a word (the desktop-Word convention); a formatting toggle over that range would wrap the
 * space too, and every other platform selects the bare word. The browser paints its own range
 * before any `dblclick` handler runs, so the word is selected HERE, on the second press, with
 * the native selection suppressed: the trimmed range is the first one ever painted.
 */

/** Trim trailing whitespace off the document's current selection when it ends in a text node.
 *  A selection that is only whitespace is left alone: collapsing it would undo the click. */
export function trimDoubleClickSelection(doc: Document): boolean {
	const sel = doc.getSelection();
	if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
	const range = sel.getRangeAt(0);
	const endNode = range.endContainer;
	if (!(endNode instanceof Text)) return false;
	const text = range.toString();
	const trimmed = text.trimEnd().length;
	if (trimmed === 0 || trimmed === text.length) return false;
	const cut = text.length - trimmed;
	if (cut > range.endOffset) return false;
	sel.setBaseAndExtent(range.startContainer, range.startOffset, endNode, range.endOffset - cut);
	return true;
}

/**
 * Select the word under the point of a double-click's second press, trimmed, synchronously.
 * Word edges come from the engine's own `modify` walk so they match what its double-click would
 * have chosen. False when the point names no text position; the caller then leaves the press to
 * the browser.
 */
export function selectWordAtPoint(doc: Document, x: number, y: number): boolean {
	const sel = doc.getSelection();
	const hit = textPositionAt(doc, x, y);
	if (!sel || !hit || typeof sel.modify !== 'function') return false;
	sel.setBaseAndExtent(hit.node, hit.offset, hit.node, hit.offset);
	sel.modify('move', 'backward', 'word');
	sel.modify('extend', 'forward', 'word');
	if (sel.isCollapsed) return false;
	trimDoubleClickSelection(doc);
	return true;
}

function textPositionAt(
	doc: Document,
	x: number,
	y: number
): { node: Text; offset: number } | null {
	const position = doc.caretPositionFromPoint?.(x, y);
	if (position?.offsetNode instanceof Text) {
		return { node: position.offsetNode, offset: position.offset };
	}
	const range = doc.caretRangeFromPoint?.(x, y);
	if (range?.startContainer instanceof Text) {
		return { node: range.startContainer, offset: range.startOffset };
	}
	return null;
}
