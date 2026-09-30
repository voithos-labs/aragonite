/**
 * G1.33: in a mode that hides markers, a block the caret is about to enter paints at least one
 * position the caret can sit at; if every content byte is a hidden marker, the browser puts the
 * keystroke on whichever side of the hidden spans it likes. Built-in blocks paint markers that
 * stand over no content (`docs/design/live-mode.md` § 4.1 What live never writes); the check is
 * for plugin blocks. A table cell has no block host, so it reports its table's path.
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

/** The editable element behind the focus, which may sit on a marker or an inner span. Read from
 *  the attribute, since jsdom leaves `isContentEditable` false on an editable div. */
function editableSurfaceOf(focused: HTMLElement): HTMLElement | null {
	const el = focused.closest<HTMLElement>('[contenteditable]');
	return el && el.getAttribute('contenteditable') !== 'false' ? el : null;
}
