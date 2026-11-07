/**
 * G1.169: while a finger's range is the editor's, the DOM holds only a caret. A native range beside
 * it is one a phone draws its own handles and menu on, which the takeover exists to prevent.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

/** `nativeCollapsed`: the native selection after the takeover adopted what it could. */
export function checkFingerRangeLeavesCaret(nativeCollapsed: boolean): InvariantViolation | null {
	if (nativeCollapsed) return null;
	return {
		code: 'native-range-beside-finger-range',
		message: "a native range stands beside a finger's range the editor holds"
	};
}
