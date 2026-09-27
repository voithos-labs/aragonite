import type { Page } from '@playwright/test';
import { warnTagOfLine } from '../../dev-warn';

export interface ErrorCollector {
	/** Call once at session start, before any gesture. */
	start(): Promise<void>;
	/** `waive` names the tags this checkpoint triggers on purpose (`['tree-ops']`,
	 *  `['svelte:derived_inert']`); anything else recorded since `start` throws. */
	assertNone(waive?: string[]): Promise<void>;
}

/**
 * Watches console and page errors, failing dev warnings, and the editor's `error` event.
 * `assertNone` runs at every checkpoint, so a warning shows mid-session, not only at teardown.
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
