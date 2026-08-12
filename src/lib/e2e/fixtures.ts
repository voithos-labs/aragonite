import { test as base, expect, type ConsoleMessage } from '@playwright/test';
import { getContainerParityMismatches } from './container-parity';

// Shared e2e `test`, carrying two teardown guards. 1) The console watch: every dev warning
// reaches the console under the `[aragonite:…]` sentinel and not the structured error event,
// so a spec watching only `getCapturedErrors()` lets a fire pass. Two classes, one door each:
// invariant fires name their tags via `test.use({ expectInvariants })`, plain dev warns via
// `test.use({ expectWarns })`. Both are bidirectional — each named tag must fire and no other
// may, so an expected fire that stops firing is caught too. 2) The container-parity walk,
// which the console cannot cover: `each_key_duplicate` is swallowed by BlockHost's boundary
// with no console line; gated on an editor having registered a document, so editor-less
// routes skip.

interface WarnFixtures {
	/** Invariant tags this spec deliberately triggers, e.g. `['late-opener-registration']`. */
	expectInvariants: string[];
	/** Plain devWarn tags this spec deliberately triggers, e.g. `['tree-ops']`. */
	expectWarns: string[];
}

const SENTINEL_TAG = /\[aragonite:([^\]]+)\]/;

export const test = base.extend<WarnFixtures>({
	expectInvariants: [[], { option: true }],
	expectWarns: [[], { option: true }],
	page: async ({ page, expectInvariants, expectWarns }, use) => {
		const fires: { tag: string; text: string }[] = [];
		const onConsole = (m: ConsoleMessage) => {
			const type = m.type();
			if (type !== 'warning' && type !== 'error') return;
			const tag = SENTINEL_TAG.exec(m.text())?.[1];
			if (tag) fires.push({ tag, text: `${type}: ${m.text()}` });
		};
		page.on('console', onConsole);
		await use(page);
		page.off('console', onConsole);

		// `assertInvariant` relays under the `invariant:` tag prefix, so the two option lists
		// meet in one namespace and one watch covers both classes.
		const expected = new Set([
			...expectInvariants.map((tag) => `invariant:${tag}`),
			...expectWarns
		]);
		const unexpected = fires.filter((f) => !expected.has(f.tag)).map((f) => f.text);
		expect(unexpected, `unexpected [aragonite:…] console fires:\n${unexpected.join('\n')}`).toEqual(
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
