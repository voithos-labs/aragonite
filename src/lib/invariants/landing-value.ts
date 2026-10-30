/**
 * G1.43: reading a commit's landing moves no caret. The landing is a value the commit puts down
 * itself, so a landing function that focuses or selects is placing a second caret behind its back.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { readNativeSelection } from '../browser/selection-read';

/** Where focus and the selection's anchor are, compared by identity. */
export interface CaretWhereabouts {
	readonly active: Element | null;
	readonly anchorNode: Node | null;
	readonly anchorOffset: number;
}

export function readCaretWhereabouts(): CaretWhereabouts | null {
	// With no document there is no focus or selection a landing could move, so nothing to compare.
	if (typeof document === 'undefined') return null;
	const anchor = readNativeSelection()?.anchor;
	return {
		active: document.activeElement,
		anchorNode: anchor?.node ?? null,
		anchorOffset: anchor?.offset ?? 0
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
