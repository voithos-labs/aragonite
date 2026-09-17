/** Native-vs-synthetic caret and plain-key guards shared across the text surface. */

import { isCharacterKey } from '../../../schema/keybindings';
import { isHiddenMarkerText } from '../../../cursor/widget-offset';

/** Caret in a real text node the reader can see: the native caret renders there, so the
 *  synthetic indicator stands down. Hidden marker text renders nothing, so it does not count. */
export function caretIsInTextContent(el: HTMLElement, sel: Selection | null): boolean {
	if (!sel || sel.rangeCount === 0) return false;
	return seatIsInTextContent(el, sel.getRangeAt(0).startContainer);
}

/** The same read for a seat named by its node — the one a press is about to make. */
export function seatIsInTextContent(el: HTMLElement, node: Node): boolean {
	return node.nodeType === Node.TEXT_NODE && el.contains(node) && !isHiddenMarkerText(node, el);
}

/** A ranged selection this surface holds — the click ladder's rungs, a shift-click, a
 *  drag-select. It is the gesture's own paint, so a click-time caret seat stands down for it. */
export function surfaceHoldsRange(el: HTMLElement, sel: Selection | null): boolean {
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
	const range = sel.getRangeAt(0);
	return el.contains(range.startContainer) || el.contains(range.endContainer);
}

/** Ctrl/meta/alt held — a platform command, never an edit of the byte beside the caret. */
export function hasModifier(e: KeyboardEvent): boolean {
	return e.ctrlKey || e.metaKey || e.altKey;
}

/** A typed character: no modifier chord, one code point. A chord is a command instead. */
export function isPlainTypingKey(e: KeyboardEvent): boolean {
	return !hasModifier(e) && isCharacterKey(e.key);
}
