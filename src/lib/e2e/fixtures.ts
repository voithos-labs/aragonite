import { test as base, expect, type ConsoleMessage } from '@playwright/test';
import { getContainerParityMismatches } from './container-parity';

// Shared e2e `test`, carrying two teardown guards. 1) The console watch: every dev warning
// reaches the console under the `[aragonite:…]` sentinel, and every Svelte runtime warning under
// `[svelte] <code>`, rather than the structured error event, so a spec watching only
// `getCapturedErrors()` lets a fire pass. A spec that trips one declares its tags below,
// bidirectionally: each named tag must fire and no other may. 2) The container-parity walk, which
// the console cannot cover: `each_key_duplicate` is swallowed by BlockHost's boundary with no
// console line; gated on an editor having registered a document, so editor-less routes skip.

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

/** A prefix `expectWarns` may not carry: each namespace has a door of its own. */
const NAMESPACED = /^(invariant|svelte):/;

/** The two console heads share one tag namespace, so one watch and one claim door cover both. */
function fireOf(m: ConsoleMessage): { tag: string; text: string } | null {
	const text = `${m.type()}: ${m.text()}`;
	const sentinel = SENTINEL_TAG.exec(m.text())?.[1];
	if (sentinel) return { tag: sentinel, text };
	const code = SVELTE_CODE.exec(m.text())?.[1];
	if (!code) return null;
	// Under the dev server every Svelte warn reports Vite's console proxy as its origin, which
	// names nothing; the code inside the text is the whole signal there.
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

		// `assertInvariant` relays under the `invariant:` tag prefix, so the three option lists
		// meet in one namespace and one watch covers all three classes.
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

		// Console delivery to the Node listener is async, so a required fire may still
		// be in flight when the test body ends; poll rather than read once, listener still on.
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
