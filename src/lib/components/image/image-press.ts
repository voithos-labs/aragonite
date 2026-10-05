// Which pointer presses end an image selection, for the overlay's and the popover's
// click-outside handlers.

import { findSurfacePathForElement } from '../../selection/path-lookup';

// The widget itself and the overlay controls attached to it never count as outside.
const IMAGE_CHROME_SELECTOR = '[data-image-widget], [data-image-overlay]';

/** Whether a press should end the image selection. A Shift-press on this editor's text is left
 *  to that block, which grows a range from the image and ends it. */
export function pressLeavesImage(press: PointerEvent, editorRoot: Element | null): boolean {
	const target = press.target instanceof Element ? press.target : null;
	if (target?.closest(IMAGE_CHROME_SELECTOR)) return false;
	const ownedByBlock =
		press.shiftKey && !!editorRoot?.contains(target) && findSurfacePathForElement(target) !== null;
	return !ownedByBlock;
}
