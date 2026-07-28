import { test as base, expect, type ConsoleMessage } from '@playwright/test';
import { getContainerParityMismatches } from './container-parity';

// Shared e2e `test`, carrying two independent teardown guards.
//
// 1. The console watch. Commit-time and startup invariants devWarn on the console
//    (`[invariant:…]`) rather than through the structured error event, so a spec that
//    only watches `getCapturedErrors()` lets a fire pass silently — the gap that left
//    `column-scope-alignment` observable by no gate. A spec that INTENTIONALLY trips an
//    invariant names the tags it requires: `test.use({ expectInvariants: ['late-opener-registration'] })`.
//    Each named tag must fire and no other tag may, so an expected fire that stops
//    firing is caught too — a blanket boolean waiver could not see that.
//
// 2. The container-parity walk. The console watch cannot see the childIds↔children
//    desync class: Svelte throws `each_key_duplicate` on the trailing undefined keys,
//    BlockHost's `<svelte:boundary onerror>` swallows it into the editor's `error`
//    event (no console line, no pageerror). So teardown also probes every live tree's
//    container parity directly. This is orthogonal to the console watch and runs
//    unconditionally — a spec that expects an invariant fire has no reason to waive it.
//    Gated only on an editor having registered a document, so editor-less routes skip
//    instead of tripping the walker's loud-on-absent throw.

interface InvariantFixtures {
	/** Invariant tags this spec deliberately triggers, e.g. `['late-opener-registration']`. */
	expectInvariants: string[];
}

const INVARIANT_TAG = /\[invariant:([^\]]+)\]/;

export const test = base.extend<InvariantFixtures>({
	expectInvariants: [[], { option: true }],
	page: async ({ page, expectInvariants }, use) => {
		const fires: { tag: string; text: string }[] = [];
		const onConsole = (m: ConsoleMessage) => {
			const type = m.type();
			if (type !== 'warning' && type !== 'error') return;
			const tag = INVARIANT_TAG.exec(m.text())?.[1];
			if (tag) fires.push({ tag, text: `${type}: ${m.text()}` });
		};
		page.on('console', onConsole);
		await use(page);
		page.off('console', onConsole);

		const expected = new Set(expectInvariants);
		const unexpected = fires.filter((f) => !expected.has(f.tag)).map((f) => f.text);
		expect(unexpected, `unexpected [invariant:…] console fires:\n${unexpected.join('\n')}`).toEqual(
			[]
		);

		// Console delivery to the Node listener is async, so a required fire may still
		// be in flight when the test body ends; poll rather than read once.
		if (expected.size > 0) {
			await expect
				.poll(() => [...expected].filter((tag) => !fires.some((f) => f.tag === tag)))
				.toEqual([]);
		}

		const hasEditor = await page
			.evaluate(
				() => ((window as { __parityDocuments?: unknown[] }).__parityDocuments ?? []).length
			)
			.then((count) => count > 0)
			.catch(() => false);
		if (hasEditor) {
			const mismatches = await getContainerParityMismatches(page);
			expect(
				mismatches,
				`container children/childIds parity broken at teardown:\n${JSON.stringify(mismatches, null, 2)}`
			).toEqual([]);
		}
	}
});

export { expect };
