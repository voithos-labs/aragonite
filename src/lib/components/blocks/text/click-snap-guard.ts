/** Shared checks about the caret and the key, used across a text block's editable element. */

import { isCharacterKey } from '../../../schema/keybindings';
import { isHiddenMarkerText } from '../../../cursor/widget-offset';

/** Caret in a text node the user can see: the browser draws a caret there, so the editor's own
 *  caret indicator is not needed. Hidden marker text renders nothing, so it does not count. */
export function caretIsInTextContent(el: HTMLElement, sel: Selection | null): boolean {
	if (!sel || sel.rangeCount === 0) return false;
	return seatIsInTextContent(el, sel.getRangeAt(0).startContainer);
}

/** The same read for a seat named by its node — the one a press is about to make. */
export function seatIsInTextContent(el: HTMLElement, node: Node): boolean {
	return node.nodeType === Node.TEXT_NODE && el.contains(node) && !isHiddenMarkerText(node, el);
}

/** Whether this element holds a selected range: a double or triple click, a shift-click, a
 *  drag-select. The gesture drew that range, so click-time caret placement leaves it alone. */
export function surfaceHoldsRange(el: HTMLElement, sel: Selection | null): boolean {
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
	const range = sel.getRangeAt(0);
	return el.contains(range.startContainer) || el.contains(range.endContainer);
}

/** Ctrl, meta or alt held: a platform command, never an edit of the byte beside the caret. */
export function hasModifier(e: KeyboardEvent): boolean {
	return e.ctrlKey || e.metaKey || e.altKey;
}

/** A typed character: no modifier chord, one code point. A chord is a command instead. */
export function isPlainTypingKey(e: KeyboardEvent): boolean {
	return !hasModifier(e) && isCharacterKey(e.key);
}
