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

// Rows above a shape's cap are not generated; omissions are recorded in the
// requirements file. 0.8.6 virtual rendering un-capped the MULTI-block shapes
// whose 10MB blocker was mounting every block: many-small-blocks +
// nested-containers (Phase 2 top-level windowing) and table-heavy (Phase 2 — many
// small tables stay below the watermark) now load and settle a keystroke at 10MB
// (verified PERF=1).
//   The single-giant-CONTAINER shapes stay capped: VR bounds their RENDERING
//   (proven at 2MB in virtual-rendering.spec.ts), but their 10MB LOAD does not
//   complete in 60s — the one-time parse + inline-content build for a single
//   container with hundreds of thousands of children is O(doc), which VR (a
//   rendering optimization) does not address. All three fail identically,
//   including the list/blockquote shapes that touch no table code, so it is the
//   single-giant-container load axis (incremental parsing 0.8.1 / lazy
//   inlineContent 0.8.5), not a windowing bug.
//   reference-heavy stays capped: its 10MB keystroke is bounded by reference/LRD
//   resolution over the whole document, not mounted-component count (0.8.4).
const MAX_BYTES: Partial<Record<FixtureShape, number>> = {
	'reference-heavy': 1_000_000,
	'giant-single-list': 1_000_000,
	'giant-single-blockquote': 1_000_000,
	'giant-single-table': 1_000_000
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
