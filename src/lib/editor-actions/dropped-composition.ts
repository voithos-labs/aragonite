/**
 * How a holder of a composing flag keeps it in step with the browser: a composition the browser
 * dropped without a `compositionend`, and one it runs here though the start went elsewhere. Every
 * holder asks about a drop on every signal it reads the flag at (a key, a beforeinput, an input, a
 * new compositionstart) and about an opening at each beforeinput, or the two drift apart.
 */

import { devWarn } from '@voithos-labs/aragonite/dev-checks';
import { readInput } from '../browser/input';

/** What a composing-flag holder heard: the event, or `compositionstart` where it gets none. */
export type CompositionSignal = Event | 'compositionstart';

/** Whether `signal` arrived outside a composition the caller holds open; warns when it did, since
 *  the caller then commits whatever the browser left on screen. */
export function reportDroppedComposition(signal: CompositionSignal, open: boolean): boolean {
	if (!open || !sentOutsideComposition(signal)) return false;
	const name = signal === 'compositionstart' ? signal : signal.type;
	devWarn(
		'composition',
		`a ${name} arrived outside the open composition with no compositionend, so the browser dropped it; the editor ended it here`
	);
	return true;
}

/** Whether `event` is a composed run with no composition open here: a range across blocks claimed
 *  the start, and this holder has the caret its removal left, so it opens the composition first. */
export function opensComposition(event: InputEvent, open: boolean): boolean {
	const read = readInput(event);
	return !open && event.isComposing && read.kind === 'compose' && !read.final;
}

function sentOutsideComposition(signal: CompositionSignal): boolean {
	if (signal === 'compositionstart') return true;
	const e = signal as Partial<InputEvent & KeyboardEvent>;
	if (e.isComposing !== false) return false;
	// A key's own beforeinput and input say `isComposing: false` even inside a live composition, and
	// its keydown carries the real state, so only typed text in either proves the composition over.
	if (e.type === 'beforeinput' || e.type === 'input')
		return readInput(signal as InputEvent).kind === 'insert';
	// The key that opens or feeds an IME reports `isComposing: false` in Chromium and WebKit.
	return e.key !== 'Process' && e.keyCode !== 229;
}
