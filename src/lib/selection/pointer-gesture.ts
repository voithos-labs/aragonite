/**
 * Who owns a press's drag. A widget claims its own (a diagram's pan) with an attribute, and on a
 * touch screen the browser owns it: a moved finger scrolls, and a long press selects with the
 * browser's own handles. The one place the editor reads `pointerType` (G4.279), so every route that
 * starts, grows or clears a selection from a press agrees on what a finger means.
 */

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

/** Runs `then` once the press `down` opened ends as a tap (its pointerup), and never when the
 *  browser takes the press over for a scroll or a long-press selection (its pointercancel). */
export function onTap(down: PointerEvent, then: () => void): void {
	const end = new AbortController();
	const mine = (e: PointerEvent) => e.pointerId === down.pointerId;
	const opts = { capture: true, signal: end.signal };
	// The document, not the window: a release reaches the drag session first (G4.225).
	document.addEventListener(
		'pointerup',
		(e) => {
			if (!mine(e)) return;
			end.abort();
			then();
		},
		opts
	);
	document.addEventListener('pointercancel', (e) => mine(e) && end.abort(), opts);
}
