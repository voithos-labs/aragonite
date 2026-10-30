/**
 * G1.33: in a mode that hides markers, a block focus enters paints at least one spot a caret
 * shows at, asked of the caret writer's own classifier, so a caret no writer placed is checked too.
 * Built-ins paint markers that stand over no content (`docs/design/live-mode.md` § 4.1); the check
 * is for plugin blocks. A table cell has no block host, so it reports its table's path.
 */

import { hidesMarkers, type PresentationMode } from '../presentation-mode';
import { caretSpotOf } from '../browser/caret-spot';
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

export function checkCaretCanLand(
	focused: HTMLElement,
	mode: PresentationMode,
	blockPath: readonly number[]
): InvariantViolation | null {
	// Reading takes no keystrokes, so a construct that paints nothing is correct there.
	if (mode === 'reading' || !hidesMarkers(mode)) return null;
	const el = editableSurfaceOf(focused);
	// The block's start reads past every hidden run to the first thing that paints, if any.
	if (!el || caretSpotOf(el, { node: el, offset: 0 }) !== 'none') return null;
	return {
		code: 'caret-can-land',
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
