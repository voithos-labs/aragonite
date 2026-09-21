import type { Page } from '@playwright/test';

export interface ErrorCollector {
	/** Call once at session start, before any gesture. */
	start(): Promise<void>;
	/** Throws if anything recorded a failure since `start`. `waive` names the tags this
	 *  checkpoint triggers on purpose (`['tree-ops']`, `['svelte:derived_inert']`); anything
	 *  else fails. */
	assertNone(waive?: string[]): Promise<void>;
}

/** Every editor dev warning, failed checks included: `devWarn` tags them all. */
const SENTINEL_TAG = /\[aragonite:([^\]]+)\]/;

/** Svelte's own runtime warnings carry no `[aragonite:…]` tag; they lead with their code. */
const SVELTE_CODE = /\[svelte\]\s+([a-z0-9_]+)/;

/** Both kinds of console warning carry a tag, so one waiver list covers both. */
function warnTagOf(text: string): string | null {
	const sentinel = SENTINEL_TAG.exec(text)?.[1];
	if (sentinel) return sentinel;
	const code = SVELTE_CODE.exec(text)?.[1];
	return code ? `svelte:${code}` : null;
}

/**
 * Three things a long session must stay clean on: console errors and page errors, dev warnings
 * that fail the run, and the editor's structured `error` event (a failure the editor catches
 * rather than throws). `fixtures.ts` also fails on a dev warning, but only at teardown, while
 * `assertNone` runs at every checkpoint, so one shows up mid-session.
 */
export function attachErrorCollector(page: Page): ErrorCollector {
	const errors: string[] = [];
	const warnings: { tag: string; text: string }[] = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('console', (m) => {
		const type = m.type();
		if (type === 'error') {
			errors.push(`console.error: ${m.text()}`);
			return;
		}
		if (type !== 'warning') return;
		const tag = warnTagOf(m.text());
		if (tag) warnings.push({ tag, text: `failing warning: ${m.text()}` });
	});
	return {
		async start() {
			await page.evaluate(() => (window as any).__test.startErrorCapture());
		},
		async assertNone(waive: string[] = []) {
			const origins: string[] = await page.evaluate(() =>
				(window as any).__test.getCapturedErrors()
			);
			const all = [
				...errors,
				...warnings.filter((w) => !waive.includes(w.tag)).map((w) => w.text),
				...origins.map((o) => `editor error event: origin=${o}`)
			];
			if (all.length) {
				throw new Error(`Console/page/editor errors during session:\n${all.join('\n')}`);
			}
		}
	};
}
