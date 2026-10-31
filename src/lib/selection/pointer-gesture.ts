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

/** Runs `clear` for a press that ends what is selected: at once for a mouse or a pen, and for a
 *  finger only once the press ends as a tap, so a press the browser takes over keeps it. */
export function clearOnPress(
	down: PointerEvent,
	lifetime: AbortSignal | null,
	clear: () => void
): void {
	if (isTouchPointer(down)) onTap(down, lifetime, clear);
	else clear();
}

// A tap is the press's pointerup; its pointercancel (the browser took it) or the editor
// unmounting first (`lifetime` aborts) runs nothing.
function onTap(down: PointerEvent, lifetime: AbortSignal | null, then: () => void): void {
	if (lifetime?.aborted) return;
	const end = new AbortController();
	const mine = (e: PointerEvent) => e.pointerId === down.pointerId;
	const opts = { capture: true, signal: end.signal };
	lifetime?.addEventListener('abort', () => end.abort(), { signal: end.signal });
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
