/**
 * G1.54: a commit's mutation writes only the scope views it was handed, so the tree's own top-level
 * array is the same array, holding the same blocks, when the mutation returns. The document's view
 * is a plain copy the commit installs afterwards.
 */

import type { InvariantViolation } from '../assert';

export function checkTopLevelUntouched(
	live: readonly unknown[],
	tree: readonly unknown[],
	before: readonly unknown[]
): InvariantViolation | null {
	if (live !== tree) return violation('the mutation replaced the top-level array');
	const moved = tree.length !== before.length || tree.some((node, i) => node !== before[i]);
	return moved ? violation('the mutation wrote the top-level array, not its scope view') : null;
}

function violation(message: string): InvariantViolation {
	return { code: 'top-level-untouched', message };
}
