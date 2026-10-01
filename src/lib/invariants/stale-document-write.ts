/**
 * G1.53: a write made for a document a `source` swap replaced is refused. It would land at the
 * same place in the incoming document, or fire an `edit` a host reads against the wrong note.
 */

import type { InvariantViolation } from '../assert';

export function checkDocumentStamp(
	stamp: { live: boolean },
	op: string
): InvariantViolation | null {
	if (stamp.live) return null;
	return {
		code: 'stale-document-write',
		message: `refused '${op}': it was made for a document a source swap has replaced`,
		detail: { op }
	};
}
