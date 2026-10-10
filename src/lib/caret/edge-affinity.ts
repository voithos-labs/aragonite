/**
 * The caret memory's record at a hidden edge: what overrides the edge rule, where a letter takes the
 * format of the character before the caret (`docs/design/live-mode.md` § 4.2). The edge resolver in
 * `edge-seat.ts` is the one reader; this module also says which keys end the record.
 */

import { BARE_MODIFIER_KEYS, isCharacterKey } from '../schema/keybindings';

/**
 * `outside` puts the next letter outside every construct whose hidden run the caret touches: a fresh
 * start (Enter, a click past a line's end) or a typed closer. An offset is the code chip stop the
 * bar is drawn at, which the chip's arrow step picks.
 */
export type EdgeAffinity = 'outside' | PinnedOffset;

/** One boundary of the caret's screen position. Every write ends it, and the resolver ignores one
 *  the caret's position does not hold. */
export interface PinnedOffset {
	readonly offset: number;
}

/** Which way a key steps across a code chip's border (`edge-step.ts`): only a plain ArrowLeft or
 *  ArrowRight, since Shift extends a range, Ctrl and Alt jump a word and Meta jumps the line. */
export function edgeStepDirection(
	e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'isComposing'>
): 'backward' | 'forward' | null {
	if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return null;
	if (e.key === 'ArrowRight') return 'forward';
	return e.key === 'ArrowLeft' ? 'backward' : null;
}

/** The plain key whose caret move a code chip's edge settles after the browser makes it, or
 *  null: ArrowLeft arrives from the chip's right, and End lands past a chip ending the line. */
export function chipArrivalKey(
	e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'isComposing'>
): 'ArrowLeft' | 'End' | null {
	if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return null;
	if (e.key === 'End') return 'End';
	return e.key === 'ArrowLeft' ? 'ArrowLeft' : null;
}

/** What a keydown does to the record: a navigation key moves the caret, any other key that isn't
 *  typing or a modifier changes the text another way, and both end it. */
export type CaretKeyAction = 'preserve' | 'navigate' | 'reset';

/** Pure on the key, so the matrix is testable without a DOM or a memory instance. */
export function classifyCaretKey(key: string): CaretKeyAction {
	switch (key) {
		case 'ArrowLeft':
		case 'ArrowRight':
		case 'ArrowUp':
		case 'ArrowDown':
		case 'PageUp':
		case 'PageDown':
		case 'Home':
		case 'End':
			return 'navigate';
		// A soft keyboard or an IME names no key; its text follows on `beforeinput`, which reads it.
		case 'Unidentified':
		case 'Process':
			return 'preserve';
	}
	// Bare modifiers come from the key-combination parser, which knows AltGraph. A printable key
	// preserves because the typing path reads the record later in this same keydown.
	return BARE_MODIFIER_KEYS.includes(key) || isCharacterKey(key) ? 'preserve' : 'reset';
}
