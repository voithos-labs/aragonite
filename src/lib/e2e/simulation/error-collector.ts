import type { Page } from '@playwright/test';

export interface ErrorCollector {
	/** Call once at session start, before any gesture. */
	start(): Promise<void>;
	/** Throw if any channel recorded a failure since `start`. `waive` names the devWarn tags
	 *  this checkpoint provokes on purpose (e.g. `['tree-ops']`); everything else reds. */
	assertNone(waive?: string[]): Promise<void>;
}

/** Every editor dev warning, invariant fires included — `devWarn` heads them all. */
const SENTINEL_TAG = /\[aragonite:([^\]]+)\]/;

/** Svelte's own runtime warn for the raw-vs-proxy ref-slot class, so it carries no sentinel. */
const RUNTIME_WARNINGS = ['state_proxy_equality_mismatch'];

/** The tag of an unsentinelled runtime warn: waivable only by an explicit empty-string tag. */
const UNTAGGED = '';

/**
 * Three channels a long session must stay clean on: console errors + pageerrors,
 * gate-failing dev warnings, and the editor's structured `error` event (failures the
 * editor CONTAINS rather than throws). `fixtures.ts` also fails on a dev warning, but
 * only at spec teardown — `assertNone` runs at checkpoints, so a fire surfaces mid-session.
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
		const tag = SENTINEL_TAG.exec(m.text())?.[1];
		if (tag !== undefined) warnings.push({ tag, text: `failing warning: ${m.text()}` });
		else if (RUNTIME_WARNINGS.some((mark) => m.text().includes(mark)))
			warnings.push({ tag: UNTAGGED, text: `failing warning: ${m.text()}` });
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
