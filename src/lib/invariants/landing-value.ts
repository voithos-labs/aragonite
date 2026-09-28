/**
 * G1.42: reading a commit's landing moves no caret. The landing is a value the commit puts down
 * itself, so a landing function that focuses or selects is placing a second caret behind its back.
 */

import type { InvariantViolation } from '../assert';

/** Where focus and the selection's anchor are, compared by identity. */
export interface CaretWhereabouts {
	readonly active: Element | null;
	readonly anchorNode: Node | null;
	readonly anchorOffset: number;
}

export function readCaretWhereabouts(): CaretWhereabouts | null {
	if (typeof document === 'undefined') return null;
	const selection = document.getSelection();
	return {
		active: document.activeElement,
		anchorNode: selection?.anchorNode ?? null,
		anchorOffset: selection?.anchorOffset ?? 0
	};
}

export function checkLandingIsAValue(
	before: CaretWhereabouts | null,
	after: CaretWhereabouts | null
): InvariantViolation | null {
	if (!before || !after) return null;
	const moved =
		before.active !== after.active ||
		before.anchorNode !== after.anchorNode ||
		before.anchorOffset !== after.anchorOffset;
	if (!moved) return null;
	return {
		code: 'landing-is-a-value',
		message:
			"a commit's landing function moved focus or the selection: return the position and let the commit put the caret there"
	};
}
