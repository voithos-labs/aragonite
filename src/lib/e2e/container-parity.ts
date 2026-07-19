/**
 * Container-parity invariant for keyed BlockList rendering (E2E side).
 *
 * Mirrors `test/harness/container-parity.ts` for browser-context checks.
 * Every container rendered through BlockList (blockquote, list, listItem, table,
 * tableRow) must keep `node.children.length === node.childIds.length`. Svelte's
 * keyed `{#each childIds as id}` block uses `childIds` as the key source; if a
 * structural mutation extends `children` without extending `childIds`, the keys
 * for the trailing entries become `undefined`, Svelte logs `each_key_duplicate`,
 * and post-undo reconciliation drifts from CST.
 *
 * The document root has `children` but no `childIds` (top-level block ids live
 * on the editor harness, not on the doc node). The walker starts from each
 * top-level CST node and descends from there.
 *
 * `childIds` is minted lazily when a container's keyed BlockList mounts
 * (`createBlockListState`), so a windowed-out / never-mounted container carries
 * `childIds === undefined` — not a desync, and unable to render the keyed each
 * that would throw `each_key_duplicate`. The walk skips those and flags only a
 * DEFINED-but-mismatched `childIds` (the mounted-container drift class).
 *
 * Returns mismatches instead of asserting so the spec owns the diff: Playwright's
 * assertion output reads better when the expectation lives in the test, and
 * composing with other checks (pageerror, console filters) stays in its hands.
 *
 * Use after any structural mutation on a keyed container (M1 merge, list
 * indent/unindent, table row/column ops) to gate the invariant in tests.
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
		const test = (window as { __test?: { getDocument?: () => { children?: unknown[] } } }).__test;
		// A missing bridge means the walk would visit nothing and report `[]` — a
		// vacuous green that hides the desync class this probe exists to catch.
		// Callers that may run on a bridge-less route gate on presence BEFORE calling.
		if (typeof test?.getDocument !== 'function') {
			throw new Error(
				'container-parity: __test.getDocument is unavailable; the parity walk cannot run and must not report vacuous success'
			);
		}
		const doc = test.getDocument();
		for (const top of doc?.children ?? []) walk(top as Parameters<typeof walk>[0]);
		return mismatches;
	});
}
