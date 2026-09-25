/**
 * Finds keyed containers whose `children` and `childIds` differ in length, in every editor on the
 * page, through `invariants/child-id-parity.ts` as each route registers it
 * (`routes/parity-documents.svelte.ts`). A mismatch hands the keyed each block undefined keys and
 * breaks the redraw after undo. Returns the mismatches so the caller asserts.
 */

import type { Page } from '@playwright/test';

export interface ParityMismatch {
	/** Child indices from the document root down to the container. */
	path: number[];
	kind: string;
	children: number;
	ids: number | undefined;
}

export async function getContainerParityMismatches(page: Page): Promise<ParityMismatch[]> {
	return page.evaluate(() => {
		const registered = window as {
			__parityDocuments?: unknown[];
			__childIdDrifts?: () => ParityMismatch[];
		};
		const drifts = registered.__childIdDrifts;
		// With no registered document the check visits nothing and reports `[]`, a pass that
		// hides the very mismatch it looks for. A caller that may run on a route with no editor
		// checks that one registered first.
		if (!drifts || (registered.__parityDocuments ?? []).length === 0) {
			throw new Error(
				'container-parity: no editor registered a live document; the parity check cannot run and must not report vacuous success'
			);
		}
		return drifts().map(({ path, kind, children, ids }) => ({ path, kind, children, ids }));
	});
}
