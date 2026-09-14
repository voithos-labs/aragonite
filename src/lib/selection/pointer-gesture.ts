/**
 * The door a widget declares over an element whose pointer drags belong to its own gesture (a
 * diagram's pan, a canvas's brush): the editor's pointer arms decline a press inside it, so the
 * gesture never doubles as a block range. A declaration, not a `stopPropagation`: pointer events
 * are delegated at the app root, so a component's own handler runs after the editor's.
 */

/** Declared on the gesture surface itself; any descendant press counts. */
export const POINTER_GESTURE_ATTR = 'data-pointer-gesture';

export function claimsPointerGesture(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(`[${POINTER_GESTURE_ATTR}]`) !== null;
}
