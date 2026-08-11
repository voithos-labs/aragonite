/**
 * G1.33 — a block a caret is being seated in, under an editable marker-hiding rung, paints at
 * least one landable caret position. A surface whose whole content is a hidden marker run takes
 * the keystroke at an element boundary between `display:none` spans, and the engine seats the
 * byte on whichever side it likes. Built-ins satisfy it by painting chrome that stands over no
 * content (`docs/design/live-mode.md` § 4.1); this catches a plugin surface that does not.
 */

import { hidesMarkers, type PresentationMode } from '../presentation-mode';
import { paintsNoLandableContent } from '../cursor/widget-offset';
import type { InvariantViolation } from './assert';

export function checkLandableCaret(
	el: HTMLElement,
	mode: PresentationMode,
	blockPath: readonly number[]
): InvariantViolation | null {
	// Reading takes no keystrokes, so a construct that paints nothing is correct there.
	if (mode === 'reading' || !hidesMarkers(mode)) return null;
	if (!paintsNoLandableContent(el)) return null;
	return {
		code: 'landable-caret',
		message: `the block at [${blockPath}] is every byte a hidden marker run, so "${mode}" paints it nowhere and the caret being seated there has no position of its own — paint the chrome while it stands over no content`,
		detail: { path: [...blockPath], mode }
	};
}
