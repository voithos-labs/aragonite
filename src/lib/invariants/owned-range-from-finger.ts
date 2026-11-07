/**
 * G1.170: the editor owns a range inside one block only when a finger made it. A mouse's or a
 * keyboard's range inside one block is the browser's, so an owned one there skipped that rule.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

/** `fromFinger`: the press handed in came from `selection/pointer-gesture.ts :: fingerPress`. */
export function checkOwnedRangeFromFinger(fromFinger: boolean): InvariantViolation | null {
	if (fromFinger) return null;
	return {
		code: 'owned-block-range-without-finger',
		message: 'the editor took a range inside one block that no finger press made'
	};
}
