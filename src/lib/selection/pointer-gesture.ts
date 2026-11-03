/**
 * Who owns a press's drag, and what kind of pointer this is. A widget claims its own drag with an
 * attribute; on a touch screen the browser owns it (a moved finger scrolls, a long press selects).
 * The one place the editor reads `pointerType` or asks for a fine or coarse pointer (G4.279), so
 * every route that starts, grows or clears a selection, or draws a caret, agrees on a finger.
 */

import { MediaQuery } from 'svelte/reactivity';
import { readNativeSelection } from '../browser/selection-read';

/** Set on the gesture's element; a pointerdown on any descendant counts. An attribute, since a
 *  component's own `stopPropagation` runs after the editor's root-delegated handler. */
export const POINTER_GESTURE_ATTR = 'data-pointer-gesture';

export function claimsPointerGesture(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(`[${POINTER_GESTURE_ATTR}]`) !== null;
}

/** A finger, as opposed to a mouse or a pen, which select text by dragging. */
export function isTouchPointer(e: Pick<PointerEvent, 'pointerType'>): boolean {
	return e.pointerType === 'touch';
}

declare const FINGER: unique symbol;

/** A finger's press, which alone may make the editor own a range inside one block (G1.170). Made
 *  only here, by `fingerPress`. */
export interface FingerPress {
	readonly [FINGER]: true;
	readonly pointerId: number;
}

const madeHere = new WeakSet<object>();

/** The press `e` is when it is a finger's, or null for a mouse or a pen. */
export function fingerPress(
	e: Pick<PointerEvent, 'pointerType' | 'pointerId'>
): FingerPress | null {
	if (!isTouchPointer(e)) return null;
	const press = { pointerId: e.pointerId } as FingerPress;
	madeHere.add(press);
	return press;
}

/** Whether `press` came from `fingerPress`, for the dev check behind G1.170. */
export function isFingerPress(press: unknown): boolean {
	return typeof press === 'object' && press !== null && madeHere.has(press);
}

/** Reports whether each press inside `root` is a finger; returns the remover. */
export function watchPressKind(root: HTMLElement, onPress: (finger: boolean) => void): () => void {
	const listener = (e: PointerEvent) => onPress(isTouchPointer(e));
	root.addEventListener('pointerdown', listener, true);
	return () => root.removeEventListener('pointerdown', listener, true);
}

/** Whether the page's primary pointer is coarse: what a finger is taken to mean before any press. */
export function coarsePointer(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** A media answer read live as it changes. */
export interface LiveMedia {
	readonly current: boolean;
}

/** Whether the page's primary pointer is fine (a mouse, a pen); null with no media queries to ask. */
export function finePointer(): LiveMedia | null {
	return typeof matchMedia === 'function' ? new MediaQuery('(pointer: fine)') : null;
}

/** What a press that ends the selection clears: the editor's own selection, and the native caret
 *  it parked for a range across blocks. `takeOver` runs once a finger's press the browser turned
 *  into a selection ends, so the editor can take that range as its own. */
export interface PressEnds {
	selection(): void;
	nativeCaret?(): void;
	takeOver?(press: FingerPress): void;
}

/** Clears for a press that ends what is selected: a mouse's or a pen's at once, a finger's at its
 *  tap. A press the browser turns into a selection clears only `selection`, a scroll nothing. */
export function clearOnPress(
	down: PointerEvent,
	lifetime: AbortSignal | null,
	ends: PressEnds
): void {
	const tap = () => {
		// First, while the selection still says whether a parked caret is there to clear.
		ends.nativeCaret?.();
		ends.selection();
	};
	const press = fingerPress(down);
	if (!press) return tap();
	const { takeOver } = ends;
	onFingerPress(down, lifetime, {
		tap,
		selected: () => {
			ends.selection();
			if (takeOver) onPressEnd(down, lifetime, () => takeOver(press));
		}
	});
}

// A tap ends in the press's pointerup, a selection in the browser selecting under the held finger
// (a selectstart, or a range). A pointercancel (a scroll) or the editor unmounting runs nothing.
function onFingerPress(
	down: PointerEvent,
	lifetime: AbortSignal | null,
	outcome: { tap(): void; selected(): void }
): void {
	const end = listenForPress(lifetime);
	if (!end) return;
	const mine = (e: PointerEvent) => e.pointerId === down.pointerId;
	const opts = { capture: true, signal: end.signal };
	const settle = (then: () => void) => {
		end.abort();
		then();
	};
	// The document, not the window: a release reaches the drag session first (G4.225).
	document.addEventListener('pointerup', (e) => mine(e) && settle(outcome.tap), opts);
	document.addEventListener('pointercancel', (e) => mine(e) && end.abort(), opts);
	document.addEventListener('selectstart', () => settle(outcome.selected), opts);
	document.addEventListener(
		'selectionchange',
		() => readNativeSelection()?.collapsed === false && settle(outcome.selected),
		opts
	);
}

// A press the browser selected under ends in its pointerup, or in a pointercancel where the browser
// keeps the touch for its selection (Android's long press, and now and then iOS's).
function onPressEnd(down: PointerEvent, lifetime: AbortSignal | null, ended: () => void): void {
	const end = listenForPress(lifetime);
	if (!end) return;
	const opts = { capture: true, signal: end.signal };
	const finish = (e: PointerEvent) => {
		if (e.pointerId !== down.pointerId) return;
		end.abort();
		ended();
	};
	document.addEventListener('pointerup', finish, opts);
	document.addEventListener('pointercancel', finish, opts);
}

// Listeners that end with the editor; null once it has unmounted.
function listenForPress(lifetime: AbortSignal | null): AbortController | null {
	if (lifetime?.aborted) return null;
	const end = new AbortController();
	lifetime?.addEventListener('abort', () => end.abort(), { signal: end.signal });
	return end;
}
