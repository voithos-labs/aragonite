/**
 * The attribute a widget sets on an element whose pointer drags are its own gesture (a diagram's
 * pan, a canvas's brush), so the editor's pointer handlers ignore a pointerdown inside it. It is
 * an attribute because pointer events are delegated at the app root: a component's own
 * `stopPropagation` runs after the editor's handler.
 */

/** Set on the gesture's element itself; a pointerdown on any descendant counts. */
export const POINTER_GESTURE_ATTR = 'data-pointer-gesture';

export function claimsPointerGesture(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(`[${POINTER_GESTURE_ATTR}]`) !== null;
}
