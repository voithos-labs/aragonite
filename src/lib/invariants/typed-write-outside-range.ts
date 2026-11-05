/**
 * G1.174: a block writes a typed character only while the editor owns no range, since a character
 * typed over a range is the range's to replace (`selection/cross-block/range-replace.ts`).
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

export function checkTypedWriteOutsideRange(
	ownsRange: boolean,
	source: string
): InvariantViolation | null {
	return ownsRange
		? {
				code: 'typed-write-outside-range',
				message: `a block wrote a typed character (${source}) while the editor owns a range`
			}
		: null;
}
