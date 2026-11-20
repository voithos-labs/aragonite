/**
 * G1.218: after a paste commits, the document holds the range-edit core's answer as the byte
 * splice writes it (a closing line under an opener it writes included), whichever commit took it.
 * A text block's own write that re-decides its bytes (a container rebuilding around it) fires.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { sharedPrefixLength } from '../core/written-span';

/** `after`, the document a paste left, against `expected`, the core's answer as the splice writes it. */
export function checkPasteLanded(expected: string, after: string): InvariantViolation | null {
	if (after === expected) return null;
	const at = sharedPrefixLength(after, expected, Math.min(after.length, expected.length));
	const near = (text: string) => JSON.stringify(text.slice(Math.max(0, at - 20), at + 40));
	return {
		code: 'paste-lands-core-answer',
		message: `a paste left ${near(after)} at byte ${at}, where the core answered ${near(expected)}`
	};
}
