import type { Page } from '@playwright/test';
import { warnTagOfLine } from '../../dev-warn';

export interface ErrorCollector {
	/** Call once at session start, before any gesture. */
	start(): Promise<void>;
	/** Throws if anything recorded a failure since `start`. `waive` names the tags this
	 *  checkpoint triggers on purpose (`['tree-ops']`, `['svelte:derived_inert']`); anything
	 *  else fails. */
	assertNone(waive?: string[]): Promise<void>;
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
		const tag = warnTagOfLine(m.text());
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
