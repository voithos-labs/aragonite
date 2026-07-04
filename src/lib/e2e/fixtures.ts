import { test as base, expect, type ConsoleMessage } from '@playwright/test';

// Shared e2e `test`. Commit-time and startup invariants devWarn on the console
// (`[invariant:…]`) rather than through the structured error event, so a spec that
// only watches `getCapturedErrors()` lets a fire pass silently — the gap that left
// `column-scope-alignment` observable by no gate. Every spec importing this `test`
// fails on any `[invariant:` fire on its page. Specs that INTENTIONALLY trigger an
// invariant opt out with `test.use({ expectInvariants: true })` and assert the fire
// themselves.

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
		if (!expectInvariants)
			expect(fires, `unexpected [invariant:…] console fires:\n${fires.join('\n')}`).toEqual([]);
	}
});

export { expect };
