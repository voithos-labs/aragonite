import { test as base, expect, type ConsoleMessage } from '@playwright/test';
import { getContainerParityMismatches } from './container-parity';

// The shared e2e `test`, with two checks at teardown. The console watch: dev warnings tagged
// `[aragonite:…]`, Svelte warnings tagged `[svelte] <code>`, uncaught page errors (`pageerror`),
// and errors only `window.onerror` sees (`onerror:<message>`). A spec that trips one declares it
// below; each declared one must fire while nothing else may. The container-parity walk covers
// what the console cannot: BlockHost's error boundary swallows `each_key_duplicate` silently.

interface WarnFixtures {
	/** Invariant tags this spec deliberately triggers, e.g. `['late-opener-registration']`. */
	expectInvariants: string[];
	/** Plain devWarn tags this spec deliberately triggers, e.g. `['tree-ops']`. */
	expectWarns: string[];
	/** Svelte runtime warning codes this spec deliberately triggers, e.g. `['derived_inert']`. */
	expectSvelteWarns: string[];
	/** `window.onerror` messages this spec deliberately triggers, matched whole. */
	expectPageErrors: string[];
}

const SENTINEL_TAG = /\[aragonite:([^\]]+)\]/;
const SVELTE_CODE = /\[svelte\]\s+([a-z0-9_]+)/;
/** Chromium's message when a ResizeObserver callback resizes what it observes, for `expectPageErrors`. */
export const RESIZE_OBSERVER_LOOP = 'ResizeObserver loop completed with undelivered notifications.';

const ONERROR_LINE = /^\[onerror\] (.*)$/s;

/** Relays an error event that carries no thrown value to the console, since Chromium reports
 *  one (a ResizeObserver loop, say) to `window.onerror` alone; a thrown one is `pageerror`'s. */
function relayWindowErrors(): void {
	window.addEventListener('error', (e) => {
		if (e.error == null) console.error(`[onerror] ${e.message}`);
	});
}

/** A prefix `expectWarns` may not carry: each of these has its own list. */
const NAMESPACED = /^(invariant|svelte|onerror):/;

/** Every watched console line carries a tag, so one watch and one declared list cover them all. */
function fireOf(m: ConsoleMessage): { tag: string; text: string } | null {
	const text = `${m.type()}: ${m.text()}`;
	const relayed = ONERROR_LINE.exec(m.text())?.[1];
	if (relayed !== undefined) return { tag: `onerror:${relayed}`, text };
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
	expectPageErrors: [[], { option: true }],
	page: async (
		{ page, expectInvariants, expectWarns, expectSvelteWarns, expectPageErrors },
		use
	) => {
		const namespaced = expectWarns.filter((tag) => NAMESPACED.test(tag));
		expect(
			namespaced,
			`expectWarns names plain devWarn tags: [${namespaced.join(', ')}] belongs in ` +
				'expectInvariants, expectSvelteWarns or expectPageErrors, spelled without its prefix'
		).toEqual([]);

		const fires: { tag: string; text: string }[] = [];
		const onConsole = (m: ConsoleMessage) => {
			const type = m.type();
			if (type !== 'warning' && type !== 'error') return;
			const fire = fireOf(m);
			if (fire) fires.push(fire);
		};
		// An uncaught exception or rejection reaches Playwright here and never as a console line.
		const onPageError = (e: Error) =>
			fires.push({ tag: 'pageerror', text: `pageerror: ${e.stack || e.message || String(e)}` });
		page.on('console', onConsole);
		page.on('pageerror', onPageError);
		await page.addInitScript(relayWindowErrors);
		await use(page);

		// Each declared list carries its own prefix, so all four share one tag space and one watch.
		const expected = new Set([
			...expectInvariants.map((tag) => `invariant:${tag}`),
			...expectWarns,
			...expectSvelteWarns.map((code) => `svelte:${code}`),
			...expectPageErrors.map((message) => `onerror:${message}`)
		]);
		const unexpected = fires.filter((f) => !expected.has(f.tag)).map((f) => f.text);
		expect(
			unexpected,
			`unexpected [aragonite:…] / [svelte] console fires or uncaught errors:\n${unexpected.join('\n')}`
		).toEqual([]);

		// Console messages reach the Node listener asynchronously, so a required warning may
		// still be on its way when the test body ends: poll, with the listener still attached.
		if (expected.size > 0) {
			await expect
				.poll(() => [...expected].filter((tag) => !fires.some((f) => f.tag === tag)))
				.toEqual([]);
		}
		page.off('console', onConsole);
		page.off('pageerror', onPageError);

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
