/**
 * G1.47: a windowed child measures into its own block list, the one whose direct child it is. A
 * child that reached a list further up would write a height table that doesn't index it, so the
 * list refuses it (`windowing/use-container-windowing.svelte.ts`) and a dev build says why here.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

export function foreignMeasureViolation(
	childPath: readonly number[],
	listPath: readonly number[]
): InvariantViolation {
	return {
		code: 'measures-in-own-list',
		message: `the child at ${JSON.stringify(childPath)} registered with the list at ${JSON.stringify(listPath)}, which isn't its own: call \`useMeasuredChild\` before the component provides a list of its own`
	};
}
