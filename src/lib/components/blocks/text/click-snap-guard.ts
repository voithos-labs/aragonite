/** Native-vs-synthetic caret and plain-key guards shared across the text surface. */

import { isHiddenMarkerText } from '../../../cursor/widget-offset';

/** Caret in a real text node the reader can see: the native caret renders there, so the
 *  synthetic indicator stands down. Hidden marker text renders nothing, so it does not count. */
export function caretIsInTextContent(el: HTMLElement, sel: Selection | null): boolean {
	if (!sel || sel.rangeCount === 0) return false;
	const node = sel.getRangeAt(0).startContainer;
	return node.nodeType === Node.TEXT_NODE && el.contains(node) && !isHiddenMarkerText(node, el);
}

/** Ctrl/meta/alt held — a platform command, never an edit of the byte beside the caret. */
export function hasModifier(e: KeyboardEvent): boolean {
	return e.ctrlKey || e.metaKey || e.altKey;
}

/** A typed byte: no modifier chord, exactly one character. A chord is a command instead. */
export function isPlainTypingKey(e: KeyboardEvent): boolean {
	return !hasModifier(e) && e.key.length === 1;
}
