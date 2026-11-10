/**
 * What an input event asks of a selection the editor holds (a range across blocks, a widget
 * selected whole): the browser would send it to the hidden caret under that selection, so the
 * selection's owner reads it here and acts as the matching key does.
 */

import { imeOwnsInput } from '../browser/composition';
import { readInput, type DeleteDirection } from '../browser/input';

export type HeldInput =
	| { readonly kind: 'text'; readonly text: string }
	| { readonly kind: 'delete'; readonly direction: DeleteDirection }
	| { readonly kind: 'break'; readonly paragraph: boolean }
	/** A spellcheck replacement, a format command, any input an engine invents. */
	| { readonly kind: 'other' };

/** Null for input that is not the selection's: an IME's, undo and redo, a paste or a drop, and
 *  the delete half of a cut or a drag. */
export function heldInputOf(e: InputEvent): HeldInput | null {
	if (imeOwnsInput(e)) return null;
	const read = readInput(e);
	if (read.kind === 'insert') return { kind: 'text', text: e.data ?? '' };
	if (read.kind === 'break') return read;
	if (read.kind === 'replace' || read.kind === 'other') return { kind: 'other' };
	if (read.kind !== 'delete' || read.source !== 'keys') return null;
	return { kind: 'delete', direction: read.decided?.direction ?? 'backward' };
}
