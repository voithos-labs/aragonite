/**
 * Which keys a widget selected whole (an image) keeps from the browser and the host: every key the
 * browser could apply to the DOM under it, and the modified arrows that move a caret or resize the
 * widget. The selected widget's keydown and `claimsChord` both read it, so a key the editor keeps
 * is a key it claims.
 */

import { textKeyRole } from '../../../schema/keybindings';
import { hasModifier } from './click-snap-guard';

// Keys with no default a browser applies to editable text: the function keys, a modifier or lock
// key pressed alone, the context-menu key.
const NO_EDITING_DEFAULT = new Set([
	'Shift',
	'Control',
	'Alt',
	'AltGraph',
	'Meta',
	'CapsLock',
	'NumLock',
	'ScrollLock',
	'ContextMenu'
]);

const FUNCTION_KEY = /^F\d{1,2}$/;

/** Whether a selected widget keeps `e`: a modified chord goes on to the keymap unless it is an
 *  arrow that moves a caret or resizes the widget, and a key with no editing default goes on. */
export function selectedWidgetKeeps(e: KeyboardEvent): boolean {
	if (hasModifier(e)) return e.key.startsWith('Arrow') && movesCaretOrResizes(e);
	return !NO_EDITING_DEFAULT.has(e.key) && !FUNCTION_KEY.test(e.key);
}

// A caret move would read a caret the widget has none of, and Shift sideways resizes it. Any other
// modified arrow (Alt+ArrowLeft, Back on Windows; Alt+ArrowUp, the block move) reads no caret.
function movesCaretOrResizes(e: KeyboardEvent): boolean {
	const sideways = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
	return textKeyRole(e) !== null || (sideways && e.shiftKey);
}
