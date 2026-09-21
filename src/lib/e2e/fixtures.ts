import { test as base, expect, type ConsoleMessage } from '@playwright/test';
import { getContainerParityMismatches } from './container-parity';

// The shared e2e `test`, with two checks at teardown. The console watch: dev warnings arrive on
// the console tagged `[aragonite:…]` and Svelte runtime warnings tagged `[svelte] <code>`, not as
// the structured error event, so a spec watching `getCapturedErrors()` alone would miss them. A
// spec that trips one declares its tags below, and each declared tag must fire while no other
// may. The container-parity walk, which the console cannot cover: BlockHost's error boundary
// swallows `each_key_duplicate` with no console line. A route with no editor skips that walk.

interface WarnFixtures {
	/** Invariant tags this spec deliberately triggers, e.g. `['late-opener-registration']`. */
	expectInvariants: string[];
	/** Plain devWarn tags this spec deliberately triggers, e.g. `['tree-ops']`. */
	expectWarns: string[];
	/** Svelte runtime warning codes this spec deliberately triggers, e.g. `['derived_inert']`. */
	expectSvelteWarns: string[];
}

const SENTINEL_TAG = /\[aragonite:([^\]]+)\]/;
const SVELTE_CODE = /\[svelte\]\s+([a-z0-9_]+)/;

/** A prefix `expectWarns` may not carry: `invariant:` and `svelte:` each have their own list. */
const NAMESPACED = /^(invariant|svelte):/;

/** Both kinds of console warning carry a tag, so one watch and one declared list cover both. */
function fireOf(m: ConsoleMessage): { tag: string; text: string } | null {
	const text = `${m.type()}: ${m.text()}`;
	const sentinel = SENTINEL_TAG.exec(m.text())?.[1];
	if (sentinel) return { tag: sentinel, text };
	const code = SVELTE_CODE.exec(m.text())?.[1];
	if (!code) return null;
	// Under the dev server every Svelte warning reports Vite's console proxy as its origin, which
	// names nothing, so the code inside the text is all there is to go on.
	const at = m.location();
	const origin = at.url.includes('@vite/client')
		? ''
		: `\n  at ${at.url}:${at.lineNumber}:${at.columnNumber}`;
	return { tag: `svelte:${code}`, text: `${text}${origin}` };
}

export const test = base.extend<WarnFixtures>({
	expectInvariants: [[], { option: true }],
	expectWarns: [[], { option: true }],
	expectSvelteWarns: [[], { option: true }],
	page: async ({ page, expectInvariants, expectWarns, expectSvelteWarns }, use) => {
		const namespaced = expectWarns.filter((tag) => NAMESPACED.test(tag));
		expect(
			namespaced,
			`expectWarns names plain devWarn tags: [${namespaced.join(', ')}] belongs in ` +
				'expectInvariants or expectSvelteWarns, spelled without its prefix'
		).toEqual([]);

		const fires: { tag: string; text: string }[] = [];
		const onConsole = (m: ConsoleMessage) => {
			const type = m.type();
			if (type !== 'warning' && type !== 'error') return;
			const fire = fireOf(m);
			if (fire) fires.push(fire);
		};
		page.on('console', onConsole);
		await use(page);

		// `assertInvariant` reports under the `invariant:` prefix, so the three declared lists
		// end up in one tag space and one watch covers all three.
		const expected = new Set([
			...expectInvariants.map((tag) => `invariant:${tag}`),
			...expectWarns,
			...expectSvelteWarns.map((code) => `svelte:${code}`)
		]);
		const unexpected = fires.filter((f) => !expected.has(f.tag)).map((f) => f.text);
		expect(
			unexpected,
			`unexpected [aragonite:…] / [svelte] console fires:\n${unexpected.join('\n')}`
		).toEqual([]);

		// Console messages reach the Node listener asynchronously, so a required warning may
		// still be on its way when the test body ends: poll, with the listener still attached.
		if (expected.size > 0) {
			await expect
				.poll(() => [...expected].filter((tag) => !fires.some((f) => f.tag === tag)))
				.toEqual([]);
		}
		page.off('console', onConsole);

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
