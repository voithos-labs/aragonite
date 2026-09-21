/**
 * G1.33: in an editable mode that hides markers, a block the caret is about to land in has to
 * paint at least one position the caret can sit at. If every byte of its content is a hidden
 * marker run, the keystroke arrives at an element boundary between `display:none` spans and the
 * browser puts the byte on whichever side it likes. Built-in blocks satisfy this by painting
 * markers that stand over no content (`docs/design/live-mode.md` § 4.1); the check is for plugin
 * blocks that do not. A table cell has no block host, so a cell reports its table's path.
 */

import { hidesMarkers, type PresentationMode } from '../presentation-mode';
import { paintsNoLandableContent } from '../cursor/widget-offset';
import type { InvariantViolation } from '../assert';

export function checkLandableCaret(
	focused: HTMLElement,
	mode: PresentationMode,
	blockPath: readonly number[]
): InvariantViolation | null {
	// Reading takes no keystrokes, so a construct that paints nothing is correct there.
	if (mode === 'reading' || !hidesMarkers(mode)) return null;
	const el = editableSurfaceOf(focused);
	if (!el || !paintsNoLandableContent(el)) return null;
	return {
		code: 'landable-caret',
		message: `the block at [${blockPath}] is every byte a hidden marker run, so "${mode}" paints it nowhere and the caret being placed there has no position of its own: paint the chrome while it stands over no content`,
		detail: { path: [...blockPath], mode }
	};
}

/** The editable element behind whatever has focus: focus can land on a block's markers or on an
 *  inner span too, and only an element that takes a keystroke can trap a caret. Read from the
 *  attribute, not `isContentEditable`, which jsdom leaves false on an editable div. */
function editableSurfaceOf(focused: HTMLElement): HTMLElement | null {
	const el = focused.closest<HTMLElement>('[contenteditable]');
	return el && el.getAttribute('contenteditable') !== 'false' ? el : null;
}
