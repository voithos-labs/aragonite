/**
 * G1.175: the right-click menu opens over the user's selection only while one is held. A press
 * read as landing on the selection that something dropped before the menu opened would offer Cut
 * and Copy over nothing.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

export function checkMenuOverSelection(
	overSelection: boolean,
	held: boolean
): InvariantViolation | null {
	return overSelection && !held
		? {
				code: 'menu-over-selection',
				message:
					'the right-click menu opened over the selection its press landed on, but none is held: something dropped it between the press and the menu'
			}
		: null;
}
