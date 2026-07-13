import type { Page } from '@playwright/test';

export interface ErrorCollector {
	/**
	 * Subscribe to the editor's structured `error` event seam. Call once at
	 * session start, before any gesture. Async because it reaches into the page.
	 */
	start(): Promise<void>;
	/** Throw if any channel recorded a failure since `start`. */
	assertNone(): Promise<void>;
}

/**
 * No global console/pageerror gate exists in the harness, so a long session
 * owns its own. It watches three channels the session must stay clean on:
 * console errors + pageerrors; `[invariant:…]`-marked dev warnings (the
 * commit/bootstrap invariant seam); and the editor's structured `error` event
 * (caught render / commit / subscriber failures the editor contains rather than
 * throws). The shared `fixtures.ts` watcher also fails on an invariant fire, but
 * only at spec teardown — `assertNone` runs at the session's checkpoints, so a
 * fire surfaces mid-session instead. Attach before any gesture, then `await
 * start()`.
 */
export function attachErrorCollector(page: Page): ErrorCollector {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('console', (m) => {
		const type = m.type();
		if (type === 'error') errors.push(`console.error: ${m.text()}`);
		else if (type === 'warning' && m.text().includes('[invariant:'))
			errors.push(`invariant violation: ${m.text()}`);
	});
	return {
		async start() {
			await page.evaluate(() => (window as any).__test.startErrorCapture());
		},
		async assertNone() {
			const origins: string[] = await page.evaluate(() =>
				(window as any).__test.getCapturedErrors()
			);
			const all = [...errors, ...origins.map((o) => `editor error event: origin=${o}`)];
			if (all.length) {
				throw new Error(`Console/page/editor errors during session:\n${all.join('\n')}`);
			}
		}
	};
}
