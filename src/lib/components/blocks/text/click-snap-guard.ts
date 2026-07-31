/** Native-vs-synthetic caret and plain-key guards shared across the text surface. */

/** Caret in a real text node: the native caret renders, so the synthetic indicator stands down. */
export function caretIsInTextContent(el: HTMLElement, sel: Selection | null): boolean {
	if (!sel || sel.rangeCount === 0) return false;
	const range = sel.getRangeAt(0);
	return range.startContainer.nodeType === Node.TEXT_NODE && el.contains(range.startContainer);
}

/** Ctrl/meta/alt held — a platform command, never an edit of the byte beside the caret. */
export function hasModifier(e: KeyboardEvent): boolean {
	return e.ctrlKey || e.metaKey || e.altKey;
}

/** A typed byte: no modifier chord, exactly one character. A chord is a command instead. */
export function isPlainTypingKey(e: KeyboardEvent): boolean {
	return !hasModifier(e) && e.key.length === 1;
}
