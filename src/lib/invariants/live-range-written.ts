/**
 * G1.168: in live mode the editor writes every key's edit over a selection in one block. The
 * browser edits the selection as the DOM holds it, whose ends can sit on either side of a hidden
 * run, so its own edit can drop a hidden `[` or keep a hidden `](url)`.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

/** `declinedOverSelection`: the shared range-edit step left a key over a live selection alone. */
export function checkLiveRangeWritten(declinedOverSelection: boolean): InvariantViolation | null {
	if (!declinedOverSelection) return null;
	return {
		code: 'live-range-left-to-browser',
		message: "a key over a selection in live mode was left to the browser's own edit"
	};
}
