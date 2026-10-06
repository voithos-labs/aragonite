/**
 * G1.71: a command key over a range runs in the kind of block whose keymap claimed it, the block
 * the range's removal was picked to leave the caret in.
 */

import type { AnyBlockKind } from '../core/nodes';
import type { InvariantViolation } from '../assert';

export function checkCommandLanding(
	claimed: AnyBlockKind,
	ran: AnyBlockKind
): InvariantViolation | null {
	return claimed === ran
		? null
		: {
				code: 'command-key-landing',
				message: `a command key over a range was claimed by a ${claimed}'s keymap and ran in a ${ran}`
			};
}
