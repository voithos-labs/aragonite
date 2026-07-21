/**
 * Small native-vs-synthetic guards shared across the text surface: does the caret
 * sit in real text (so native rendering wins over a synthetic overlay), and is a
 * key a plain typed byte (versus a modifier chord the keymap owns).
 */

/** True when the caret sits in a real text node — a valid in-text caret
 * the synthetic indicator shouldn't fight (native caret renders). */
export function caretIsInTextContent(el: HTMLElement, sel: Selection | null): boolean {
	if (!sel || sel.rangeCount === 0) return false;
	const range = sel.getRangeAt(0);
	return range.startContainer.nodeType === Node.TEXT_NODE && el.contains(range.startContainer);
}

/** A plain printable key: no ctrl/meta/alt chord, exactly one character. The text
 *  surfaces treat it as a typed byte; a modifier chord is a command. */
export function isPlainTypingKey(e: KeyboardEvent): boolean {
	if (e.ctrlKey || e.metaKey || e.altKey) return false;
	return e.key.length === 1;
}
