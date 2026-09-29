/**
 * G1.45: a caret landing's focus call and DOM placement scroll nothing. The landing's reveal policy
 * is the one scroll it makes, through the scroll owner; a focus without `preventScroll` is a
 * second writer nobody owns.
 */

import type { InvariantViolation } from '../assert';

export function checkLandingFocusScrollsNothing(
	before: number | null,
	after: number | null
): InvariantViolation | null {
	if (before === null || after === null || before === after) return null;
	return {
		code: 'landing-focus-scrolls-nothing',
		message: `a caret landing's focus moved the scroll position (${before} to ${after}): pass \`preventScroll\` and let the reveal policy scroll`
	};
}
