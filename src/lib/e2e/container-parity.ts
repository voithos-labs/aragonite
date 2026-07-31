/**
 * Container-parity invariant for keyed BlockList rendering, the browser-context mirror of
 * `test/harness/container-parity.ts`. Detects: a structural mutation that extends `children`
 * without `childIds`, giving the trailing keyed-each entries `undefined` keys and drifting
 * post-undo reconciliation from the CST.
 *
 * Deliberately tolerated: a never-mounted container, whose `childIds` is minted lazily and so
 * reads `undefined` — not a desync, and unable to render the keyed each at all. Only a
 * DEFINED-but-mismatched `childIds` is flagged.
 *
 * Subjects come from `window.__parityDocuments`, not the single-editor `window.__test`
 * handle, which on a two-editor route audits whichever registered first. Returns mismatches
 * rather than asserting, so the spec owns the diff and can compose it with other checks.
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
