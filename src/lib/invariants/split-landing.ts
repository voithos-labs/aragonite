/**
 * G1.34 — a split's landing is the index the primitive returned. `blockIndex + 1` is right
 * only while the first half stays one block; a first half whose bytes reparse plural pushes
 * the second half further down, and a caller that re-derives the landing seats the caret on
 * the first half's tail.
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
