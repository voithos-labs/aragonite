/**
 * G1.155: a block's write puts its caret inside the text it writes, since the fix-up places that
 * caret by counting through the written block and past it into the next.
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
