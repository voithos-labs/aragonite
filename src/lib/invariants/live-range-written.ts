/**
 * G1.168: in live mode the editor writes every edit a key or a composition makes over a selection
 * in one block. The browser edits the selection as the DOM holds it, whose ends can sit on either
 * side of a hidden run, so its own edit can drop a hidden `[` or keep a hidden `](url)`.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

export interface LiveRangeEdit {
	/** The gesture the edit came from. */
	route: 'key' | 'composition';
	/** Whether the input was one the editor rewrites over the selection it replaces. */
	overSelection: boolean;
	written: boolean;
}

export function checkLiveRangeWritten(edit: LiveRangeEdit): InvariantViolation | null {
	if (!edit.overSelection || edit.written) return null;
	return {
		code: 'live-range-left-to-browser',
		message: `a ${edit.route} over a selection in live mode was left to the browser's own edit`,
		detail: { route: edit.route }
	};
}
