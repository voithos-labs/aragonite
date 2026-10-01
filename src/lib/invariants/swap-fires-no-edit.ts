/**
 * G1.53: a `source` swap fires no `edit`. A host hears an `edit` with the outgoing document still
 * in place, so one that echoes `getSource()` writes that text back over the document it loaded.
 */

import type { InvariantViolation } from '../assert';

export function checkSwapFiresNoEdit(ops: readonly string[]): InvariantViolation | null {
	if (ops.length === 0) return null;
	return {
		code: 'swap-fired-edit',
		message: `a source swap fired edit (${ops.join(', ')}): an edit fires at its own write, never during a swap`,
		detail: { ops }
	};
}
