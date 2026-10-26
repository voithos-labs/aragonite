/**
 * G1.155: every write of a block's text puts its caret inside that text, since the fix-up places
 * the caret by counting through the written block and past it into the next.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

export function checkCaretInWrittenText(text: string, caret: number): InvariantViolation | null {
	return caret >= 0 && caret <= text.length
		? null
		: {
				code: 'caret-in-written-text',
				message: `a write of ${JSON.stringify(text)} puts its caret at ${caret}, outside the text`
			};
}
