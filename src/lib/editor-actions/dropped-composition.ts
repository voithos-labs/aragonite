/**
 * How a holder of a composing flag hears that the browser dropped a composition without a
 * `compositionend`. Every holder asks on every signal it reads the flag at (a key, a beforeinput,
 * an input, a new compositionstart), or a dropped composition leaves it refusing every later edit.
 */

import { devWarn } from '../dev-warn';

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

function sentOutsideComposition(signal: CompositionSignal): boolean {
	if (signal === 'compositionstart') return true;
	const e = signal as Partial<InputEvent & KeyboardEvent>;
	if (e.isComposing !== false) return false;
	// The key that opens or feeds an IME reports `isComposing: false` in Chromium and WebKit.
	if (e.key === 'Process' || e.keyCode === 229) return false;
	// A beforeinput only proposes an edit, and Chromium proposes a non-composing insertParagraph for
	// Enter inside a live composition; plain text typed outside one is what proves it over.
	if (e.type === 'beforeinput') return e.inputType === 'insertText';
	// An engine's own composition input types belong to the composition, whatever flag they carry.
	return !/composition/i.test(e.inputType ?? '');
}
