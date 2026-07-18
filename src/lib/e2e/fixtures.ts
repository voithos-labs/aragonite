import { test as base, expect, type ConsoleMessage } from '@playwright/test';
import { getContainerParityMismatches } from './container-parity';

// Shared e2e `test`. Commit-time and startup invariants devWarn on the console
// (`[invariant:…]`) rather than through the structured error event, so a spec that
// only watches `getCapturedErrors()` lets a fire pass silently — the gap that left
// `column-scope-alignment` observable by no gate. Every spec importing this `test`
// fails on any `[invariant:` fire on its page. Specs that INTENTIONALLY trigger an
// invariant opt out with `test.use({ expectInvariants: true })` and assert the fire
// themselves.
//
// The console watch cannot see the childIds↔children desync class: Svelte throws
// `each_key_duplicate` on the trailing undefined keys, BlockHost's `<svelte:boundary
// onerror>` swallows it into the editor's `error` event (no console line, no
// pageerror). So teardown also probes the live tree's container parity directly —
// the persistent signal of that desync — gated on the doc bridge so bridge-less
// routes skip instead of tripping the walker's loud-on-absent throw.

interface InvariantFixtures {
	expectInvariants: boolean;
}

export const test = base.extend<InvariantFixtures>({
	expectInvariants: [false, { option: true }],
	page: async ({ page, expectInvariants }, use) => {
		const fires: string[] = [];
		const onConsole = (m: ConsoleMessage) => {
			const type = m.type();
			if ((type === 'warning' || type === 'error') && m.text().includes('[invariant:'))
				fires.push(`${type}: ${m.text()}`);
		};
		page.on('console', onConsole);
		await use(page);
		page.off('console', onConsole);
		if (expectInvariants) return;

		expect(fires, `unexpected [invariant:…] console fires:\n${fires.join('\n')}`).toEqual([]);

		const hasBridge = await page
			.evaluate(() => typeof (window as { __test?: { getDocument?: unknown } }).__test?.getDocument)
			.then((t) => t === 'function')
			.catch(() => false);
		if (hasBridge) {
			const mismatches = await getContainerParityMismatches(page);
			expect(
				mismatches,
				`container children/childIds parity broken at teardown:\n${JSON.stringify(mismatches, null, 2)}`
			).toEqual([]);
		}
	}
});

export { expect };
