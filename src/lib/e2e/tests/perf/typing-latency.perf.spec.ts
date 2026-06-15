import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { EditorPage } from '../../editor-page';
import { FIXTURE_SHAPES, type FixtureShape } from '../../../test/perf/fixtures/generate';
import { measureTypingLatency } from './latency-harness';

declare const process: { env: Record<string, string | undefined> };

test.skip(!process.env.PERF, 'set PERF=1 to run the perf project');

// All rows run against the dev server with DEV invariant assertions active,
// so every number is a conservative upper bound on production latency.
const DEV_CAVEAT = 'dev server, DEV invariant assertions active — conservative upper bound';

const SIZES: Array<[label: string, bytes: number, keystrokes: number]> = [
	['100KB', 100_000, 30],
	['1MB', 1_000_000, 30],
	// Fewer keystrokes at 10MB: per-keystroke cost is O(block)+O(doc) there, and
	// 15 samples already give a stable p50/p95 for second-scale latencies.
	['10MB', 10_000_000, 15]
];

// Rows above a shape's cap are not generated; omissions are recorded in
// baseline.json and the requirements file. Probed 2026-06-10:
//   many-small-blocks / nested-containers / table-heavy @10MB — load never
//   completes (renderer cannot materialize that many DOM blocks/cells; lazy
//   rendering is roadmapped — 0.7 Track C).
//   reference-heavy @10MB — loads, but one keystroke fails to settle in 60s.
//   Re-probed after dirty-set scoping of the inline sweep: still fails — the
//   dominant per-keystroke cost at that scale is outside the sweep.
const MAX_BYTES: Partial<Record<FixtureShape, number>> = {
	'many-small-blocks': 1_000_000,
	'nested-containers': 1_000_000,
	'reference-heavy': 1_000_000,
	'table-heavy': 1_000_000
};

function round(ms: number): number {
	return Math.round(ms * 10) / 10;
}

function writeResult(shape: string, sizeLabel: string, result: object): void {
	const line = JSON.stringify(result);
	console.log(`PERF ${line}`);
	mkdirSync('perf-results', { recursive: true });
	writeFileSync(`perf-results/e2e-${shape}-${sizeLabel}.json`, line + '\n');
}

// ── Latency rows ────────────────────────────────────────────────────────────

test.describe('typing latency', () => {
	for (const shape of FIXTURE_SHAPES) {
		for (const [sizeLabel, bytes, keystrokes] of SIZES) {
			if (bytes > (MAX_BYTES[shape] ?? Infinity)) continue;
			test(`${shape} ${sizeLabel}`, async ({ page }) => {
				const editor = new EditorPage(page);
				const m = await measureTypingLatency(page, editor, shape, bytes, keystrokes);
				writeResult(shape, sizeLabel, {
					shape,
					bytes,
					loadMs: round(m.loadMs),
					keystrokes,
					keystrokeP50Ms: round(m.p50Ms),
					keystrokeP95Ms: round(m.p95Ms),
					note: DEV_CAVEAT
				});
				expect(m.samples).toHaveLength(keystrokes);
			});
		}
	}
});

// ── Bridge sanity ───────────────────────────────────────────────────────────

test('perf bridge: a keystroke drives the inline-refresh sweep', async ({ page }) => {
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent('hello world\n');
	await page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});
	await editor.focusBlockEnd(0);
	await editor.typeSlowly('x');
	await editor.bridge.waitForSourceContains('worldx');
	// The sweep runs on the debounced input flush (~250ms after the keystroke),
	// so poll the snapshot instead of reading it immediately.
	await page.waitForFunction(
		() => (window as any).__test.perf.snapshot().inlineRefreshCount >= 1,
		null,
		{ timeout: 5_000, polling: 16 }
	);
	const snapshot = await page.evaluate(() => (window as any).__test.perf.snapshot());
	expect(snapshot.inlineRefreshCount).toBeGreaterThanOrEqual(1);
});
