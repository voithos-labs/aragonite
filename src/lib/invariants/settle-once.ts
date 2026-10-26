/**
 * G1.112: a commit fixes up each body it wrote once. A mutation that settles a scope's own body
 * itself (a content write through `updateNodeContent`) and also reports an edit there would have
 * the commit run its fix-up over that body a second time.
 */

import { devChecksOn, type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

/** The bodies settled since the latest commit began, by their children arrays; null in production. */
let settledInCommit: WeakSet<readonly unknown[]> | null = null;

/** Called as a commit's mutation begins, so the check reads only what that mutation settled. */
export function startCommitSettles(): void {
	settledInCommit = devChecksOn ? new WeakSet() : null;
}

/** Called by a fix-up that runs outside the commit's own pass. */
export function noteBodySettled(children: readonly unknown[]): void {
	if (devChecksOn) settledInCommit?.add(children);
}

export function checkSettledOnce(
	children: readonly unknown[],
	reportsEdit: boolean
): InvariantViolation | null {
	if (!reportsEdit || !settledInCommit?.has(children)) return null;
	return {
		code: 'settled-twice',
		message:
			'a mutation fixed up a scope body itself and reported an edit there too, so the commit settles it a second time'
	};
}
