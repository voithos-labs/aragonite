/**
 * G1.34: where a split lands is the index the primitive returned. `blockIndex + 1` is only right
 * while the first half stays one block: a first half whose bytes reparse into several blocks
 * pushes the second half further down, and a caller that recomputes the index puts the caret at
 * the end of the first half instead.
 */

import type { InvariantViolation } from '../assert';

export function checkSplitLanding(expected: number, landing: number): InvariantViolation | null {
	if (landing === expected) return null;
	return {
		code: 'split-landing',
		message: `a split landed at index ${landing}, but its second half starts at ${expected}`,
		detail: { landing, expected }
	};
}
