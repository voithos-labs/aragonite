/**
 * The attribute a widget sets on an element whose pointer drags are its own gesture (a diagram's
 * pan, a canvas's brush): the editor's pointer handlers ignore a pointerdown inside it, so the
 * gesture never doubles as a block range. An attribute rather than `stopPropagation` because
 * pointer events are delegated at the app root, so a component's own handler runs after the
 * editor's.
 */

/** Set on the gesture's element itself; a pointerdown on any descendant counts. */
export const POINTER_GESTURE_ATTR = 'data-pointer-gesture';

export function claimsPointerGesture(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(`[${POINTER_GESTURE_ATTR}]`) !== null;
}
