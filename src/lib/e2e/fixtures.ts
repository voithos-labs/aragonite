import { test as base, expect, type ConsoleMessage } from '@playwright/test';
import { getContainerParityMismatches } from './container-parity';

// Shared e2e `test`, carrying two teardown guards. 1) The console watch: invariants devWarn
// on the console, not the structured error event, so a spec watching only
// `getCapturedErrors()` lets a fire pass. A spec that intentionally trips one names its tags
// via `test.use({ expectInvariants })`: each named tag must fire and no other may, so an
// expected fire that stops firing is caught too. 2) The container-parity walk, which the
// console cannot cover: `each_key_duplicate` is swallowed by BlockHost's boundary with no
// console line; gated on an editor having registered a document, so editor-less routes skip.

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
