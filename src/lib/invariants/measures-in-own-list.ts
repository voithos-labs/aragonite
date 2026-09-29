/**
 * G1.47: a windowed child measures into its own block list, the one whose direct child it is. A
 * child that reached a list further up would write a height table that doesn't index it.
 */

import type { InvariantViolation } from '../assert';

export function checkMeasuresInOwnList(
	childPath: readonly number[],
	listPath: readonly number[]
): InvariantViolation | null {
	const own =
		childPath.length === listPath.length + 1 && listPath.every((at, i) => childPath[i] === at);
	if (own) return null;
	return {
		code: 'measures-in-own-list',
		message: `the child at ${JSON.stringify(childPath)} registered with the list at ${JSON.stringify(listPath)}, which isn't its own: call \`useMeasuredChild\` before the component provides a list of its own`
	};
}
