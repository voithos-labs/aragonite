import type { Page } from '@playwright/test';

export interface ErrorCollector {
	/** Call once at session start, before any gesture. */
	start(): Promise<void>;
	/** Throw if any channel recorded a failure since `start`. */
	assertNone(): Promise<void>;
}

// Warnings that red the gate: invariant fires, plus the raw-vs-proxy ref-slot class
// (a proxy-equality mismatch or its downstream false double-claim report).
const FAILING_WARNINGS = ['[invariant:', 'state_proxy_equality_mismatch', '[state-registry]'];

/**
 * Three channels a long session must stay clean on: console errors + pageerrors,
 * gate-failing dev warnings, and the editor's structured `error` event (failures the
 * editor CONTAINS rather than throws). `fixtures.ts` also fails on an invariant fire, but
 * only at spec teardown — `assertNone` runs at checkpoints, so a fire surfaces mid-session.
 */
export function attachErrorCollector(page: Page): ErrorCollector {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('console', (m) => {
		const type = m.type();
		if (type === 'error') errors.push(`console.error: ${m.text()}`);
		else if (type === 'warning' && FAILING_WARNINGS.some((mark) => m.text().includes(mark)))
			errors.push(`failing warning: ${m.text()}`);
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
