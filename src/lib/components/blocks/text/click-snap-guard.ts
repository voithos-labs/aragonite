/** Shared checks about the selection and the key, used across a text block's editable element. */

import { isCharacterKey } from '../../../schema/keybindings';
import { readNativeSelection } from '../../../browser/selection-read';

/** Whether this element holds a selected range: a double or triple click, a shift-click, a
 *  drag-select. The gesture drew that range, so click-time caret placement leaves it alone. */
export function surfaceHoldsRange(el: HTMLElement): boolean {
	const live = readNativeSelection();
	if (!live || live.collapsed) return false;
	return el.contains(live.range.startContainer) || el.contains(live.range.endContainer);
}

/** Ctrl, meta or alt held: a platform command, never an edit of the byte beside the caret. */
export function hasModifier(e: KeyboardEvent): boolean {
	return e.ctrlKey || e.metaKey || e.altKey;
}

/** The key alone: no Shift, Ctrl, Alt or Meta held. */
export function isBareKey(e: KeyboardEvent): boolean {
	return !e.shiftKey && !hasModifier(e);
}

/** A typed character: no modifier chord, one code point. A chord is a command instead. */
export function isPlainTypingKey(e: KeyboardEvent): boolean {
	return !hasModifier(e) && isCharacterKey(e.key);
}
