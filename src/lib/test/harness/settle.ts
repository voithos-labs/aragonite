// Waiting out a gesture and sending a key, the one way every unit suite does both, on `tick()`
// alone (no timers, G4.4).

import { tick } from 'svelte';

/** The most scheduler turns a gesture's commit, render and after-commit work take to land. */
const SETTLE_TURNS = 12;

/** Await `tick()` until `done` answers true, or for the whole bounded budget without one: a
 *  gesture's commit and render effect land several turns after its event. */
export async function settleEditor(done?: () => boolean): Promise<void> {
	for (let i = 0; i < SETTLE_TURNS && !done?.(); i++) await tick();
}

/** A bubbling, cancelable keydown at `el`, as a browser delivers one. Its `defaultPrevented` on
 *  return is what the handler decided before the browser's default action would run. */
export function dispatchKey(el: EventTarget, init: KeyboardEventInit): KeyboardEvent {
	const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
	el.dispatchEvent(event);
	return event;
}

/** `dispatchKey`, then the wait for whatever the handler started. */
export async function pressKey(el: EventTarget, init: KeyboardEventInit): Promise<KeyboardEvent> {
	const event = dispatchKey(el, init);
	await settleEditor();
	return event;
}
