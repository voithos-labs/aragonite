/**
 * Checks each container's `children` against its `childIds`, the browser-side copy of
 * `test/harness/container-parity.ts`: extending `children` without `childIds` leaves trailing
 * keyed-each entries with undefined keys and breaks the redraw after undo. A container that
 * never mounted is fine, since `childIds` are created on mount. Every editor comes from
 * `window.__parityDocuments`, since `window.__test` on a two-editor route answers for whichever
 * registered first. Returns the mismatches rather than asserting, so the spec owns the diff.
 */

import type { Page } from '@playwright/test';

export interface ParityMismatch {
	kind: string;
	children: number;
	ids: number;
}

export async function getContainerParityMismatches(page: Page): Promise<ParityMismatch[]> {
	return page.evaluate(() => {
		const mismatches: ParityMismatch[] = [];
		const walk = (n: { kind?: string; children?: unknown[]; childIds?: unknown[] }) => {
			if (!n.children) return;
			// A container that never mounted has no childIds yet: nothing is out of step, and
			// it renders no keyed each to break. Only a defined array of the wrong length is.
			if (n.childIds !== undefined && n.children.length !== n.childIds.length) {
				mismatches.push({
					kind: n.kind ?? '?',
					children: n.children.length,
					ids: n.childIds.length
				});
			}
			for (const c of n.children) walk(c as Parameters<typeof walk>[0]);
		};
		const documents = (window as { __parityDocuments?: Array<() => { children?: unknown[] }> })
			.__parityDocuments;
		// With no registered document the walk visits nothing and reports `[]`, a pass that
		// hides the very mismatch this check looks for. A caller that may run on a route with
		// no editor checks that one registered first.
		if (!documents || documents.length === 0) {
			throw new Error(
				'container-parity: no editor registered a live document; the parity walk cannot run and must not report vacuous success'
			);
		}
		for (const getDocument of documents) {
			for (const top of getDocument()?.children ?? []) walk(top as Parameters<typeof walk>[0]);
		}
		return mismatches;
	});
}
