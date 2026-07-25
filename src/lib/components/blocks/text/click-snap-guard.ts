/**
 * Small native-vs-synthetic guards shared across the text surface: does the caret
 * sit in real text (so native rendering wins over a synthetic overlay), and is a
 * key plain — no modifier chord, and for typing exactly one character.
 */

/** True when the caret sits in a real text node — a valid in-text caret
 * the synthetic indicator shouldn't fight (native caret renders). */
export function caretIsInTextContent(el: HTMLElement, sel: Selection | null): boolean {
	if (!sel || sel.rangeCount === 0) return false;
	const range = sel.getRangeAt(0);
	return range.startContainer.nodeType === Node.TEXT_NODE && el.contains(range.startContainer);
}

/** Ctrl/meta/alt held — a platform command scoped to a word or the app, never an
 *  edit of the byte beside the caret. Every caret-edge arm declines one, so the
 *  predicate has one home rather than a copy per arm. */
export function hasModifier(e: KeyboardEvent): boolean {
	return e.ctrlKey || e.metaKey || e.altKey;
}

/** A plain printable key: no modifier chord, exactly one character. The text
 *  surfaces treat it as a typed byte; a chord is a command. */
export function isPlainTypingKey(e: KeyboardEvent): boolean {
	return !hasModifier(e) && e.key.length === 1;
}
