/**
 * Container-parity invariant for keyed BlockList rendering, the browser mirror of
 * `test/harness/container-parity.ts`: a mutation extending `children` without `childIds`
 * gives trailing keyed-each entries `undefined` keys and drifts post-undo reconciliation.
 * A never-mounted container is tolerated (`childIds` mints lazily); only a defined-but-
 * mismatched array flags. Subjects come from `window.__parityDocuments`, since the
 * `window.__test` handle on a two-editor route audits whichever registered first.
 * Returns mismatches rather than asserting, so the spec owns the diff.
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
			// An unmounted container has no minted childIds yet — not a desync, and it
			// renders no keyed each to break. Only a defined-but-mismatched array is.
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
		// No registered document means the walk would visit nothing and report `[]` —
		// a vacuous green that hides the desync class this probe exists to catch.
		// Callers that may run on an editor-less route gate on presence BEFORE calling.
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
