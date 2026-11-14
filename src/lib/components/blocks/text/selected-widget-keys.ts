/**
 * Which keys a widget selected whole (an image) keeps from the browser and the host: every key the
 * browser could apply to the DOM under it, plus the arrows a later handler would read a caret for.
 * The selected widget's keydown and `claimsChord` both read it, so a key the editor keeps is a key
 * it claims.
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
 *  arrow, and a key with no editing default goes on to the host. */
export function selectedWidgetKeeps(e: KeyboardEvent): boolean {
	if (hasModifier(e)) return e.key.startsWith('Arrow') && !sidewaysWithNoCaret(e);
	return !NO_EDITING_DEFAULT.has(e.key) && !FUNCTION_KEY.test(e.key);
}

// A sideways arrow that moves no caret and resizes nothing (Alt+ArrowLeft, Back on Windows) reads
// no caret, so it goes on to the host like any unbound chord.
function sidewaysWithNoCaret(e: KeyboardEvent): boolean {
	const sideways = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
	return sideways && !e.shiftKey && textKeyRole(e) === null;
}
