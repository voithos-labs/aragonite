/**
 * G1.61: every list move, the Enter that leaves a list included, reads the same text in the same
 * order before and after. Each move reads the list it rewrites; a merge reads around the two lines
 * its join rewrites; `tree-operations/list/keeping-order.ts` runs each move under the check.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { sameTexts } from './leaf-text';

export function checkListMoveKeepsOrder(
	before: readonly string[],
	after: readonly string[]
): InvariantViolation | null {
	if (sameTexts(before, after)) return null;
	const at = before.findIndex((text, i) => text !== after[i]);
	const where = at === -1 ? before.length : at;
	return {
		code: 'list-move-keeps-order',
		message: `a list move changed the order its text reads in: leaf ${where} read "${before[where] ?? ''}" and now reads "${after[where] ?? ''}"`
	};
}
