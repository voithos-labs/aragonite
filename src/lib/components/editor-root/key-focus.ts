/**
 * Where a keystroke stands relative to one editor, read the same way by the root keydown and by
 * `claimsChord`, so the two can't disagree on whose key it is. Every read is a `contains` or a
 * `closest`: it runs on each keystroke.
 */

import { claimsBodyChord, isForeignTextEntry, isTextEntrySurface } from '../../active-editor';

export interface KeyFocusDeps {
	/** True for nodes in the host's own header: they sit inside `root.contains`
	 *  without being the editor's own content. */
	isHostChrome(node: Node | null): boolean;
	/** True for nodes in this editor's find bar, which the host can mount outside the root. */
	isFindBar(node: Node | null): boolean;
}

/** Focus inside the editor's content or its find bar. */
export function focusInEditor(root: HTMLElement, el: Element | null, deps: KeyFocusDeps): boolean {
	return root.contains(el) || deps.isFindBar(el);
}

/** Whether the find chords reach this editor: focus in it, or nothing of the host's typing
 *  where the page-level chord routes here. */
export function searchChordsReach(
	root: HTMLElement,
	el: Element | null,
	deps: KeyFocusDeps
): boolean {
	return focusInEditor(root, el, deps) || (claimsBodyChord(root) && !isForeignTextEntry(el));
}

/** The root itself, or no element focused while body-level chords route here: the caret is a
 *  windowed-out one, or the range's. */
export function ownsWindowedOutCaret(root: HTMLElement, el: Element | null): boolean {
	const noElementFocused = el === null || el === root.ownerDocument.body;
	return el === root || (noElementFocused && claimsBodyChord(root));
}

/** Editor chrome (a toolbar button, a menu item) holds focus: no keymap, and no text field
 *  that owns its own Mod+Z. */
export function chromeHoldsFocus(root: HTMLElement, el: Element | null, deps: KeyFocusDeps) {
	return el !== null && el !== root && focusInEditor(root, el, deps) && !isTextEntrySurface(el);
}

/** WebKit goes back in history on a Backspace outside a field, and in reading mode every block
 *  is outside one, so the editor prevents it there. Any input keeps the key: a date input deletes. */
export function keepsPageOnBackspace(root: HTMLElement, el: Element | null, deps: KeyFocusDeps) {
	if (isTextEntrySurface(el) || el instanceof HTMLInputElement) return false;
	return focusInEditor(root, el, deps) || ownsWindowedOutCaret(root, el);
}

/** The element a keystroke lands on: its target when that is inside the editor, else focus, which
 *  is where a key sent now would land (an event made but never dispatched has no target). */
export function keyTargetOf(event: KeyboardEvent, root: HTMLElement, deps: KeyFocusDeps) {
	const target = event.target;
	if (target instanceof Element && focusInEditor(root, target, deps)) return target;
	return root.ownerDocument.activeElement;
}
