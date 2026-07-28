import { test, expect } from '../../fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { EditorPage } from '../../editor-page';
import { FIXTURE_SHAPES, type FixtureShape } from '../../../test/perf/fixtures/generate';
import {
	measureContainerHeadTyping,
	measureDeepNestedTyping,
	measureTypingLatency
} from './latency-harness';

declare const process: { env: Record<string, string | undefined> };

// Report-only rows: `perf:e2e` (PERF alone) runs them; the `perf:check` gate
// (PERF_GATE) skips them — they gate nothing, so the gate job shouldn't pay their
// runtime or flake risk.
test.skip(
	!process.env.PERF || !!process.env.PERF_GATE,
	'report-only — run via `npm run perf:e2e`; the perf:check gate skips these'
);

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
// requirements file. All shapes are currently un-capped: the multi-block shapes'
// 10MB blocker was mounting every block (windowing bounds the mount now), and the
// single-giant-container shapes (giant-single-list/blockquote/table) load linearly
// (~3.4s at 10MB; parse ~6%, the rest $state/tree materialization) with the mount
// VR-bounded. reference-heavy un-capped once lazy inline content removed its
// per-edit whole-document sweep over every reference-bearing block.
const MAX_BYTES: Partial<Record<FixtureShape, number>> = {};

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

// ── Container-head typing (report companion to the gated rows) ──────────────

// The caret INSIDE a giant container rather than in a paragraph ahead of it, so
// every keystroke rewrites the container's own opener line. The prose-target rows
// above cannot reach this: they prepend a paragraph precisely so the caret has a
// top-level home. Gated twins live in perf-gate; these rows carry the loadMs and
// p95 a re-bless sweep needs.
const CONTAINER_HEAD_SHAPES: Array<[shape: FixtureShape, headLeafPath: number[]]> = [
	['giant-single-list', [0, 0, 0]],
	['giant-single-blockquote', [0, 0]]
];

test.describe('typing latency — container head', () => {
	for (const [shape, headLeafPath] of CONTAINER_HEAD_SHAPES) {
		test(`${shape} head 1MB`, async ({ page }) => {
			const editor = new EditorPage(page);
			const m = await measureContainerHeadTyping(page, editor, shape, headLeafPath, 1_000_000, 30);
			writeResult(`${shape}-head`, '1MB', {
				shape,
				headLeafPath,
				bytes: 1_000_000,
				loadMs: round(m.loadMs),
				keystrokes: 30,
				keystrokeP50Ms: round(m.p50Ms),
				keystrokeP95Ms: round(m.p95Ms),
				note: DEV_CAVEAT
			});
			expect(m.samples).toHaveLength(30);
		});
	}
});

// ── At-depth typing (concern-4 corroboration, report-only) ───────────────────

// One report-only row: typing at the deepest leaf of a deep-nested document,
// where the keystroke pays the full ancestry rebuild the top-level rows skip.
// No gate, no baseline judgment — first end-to-end data on the ancestry tax.
// depth 8 × 50KB/level is the realistic worst corner the vitest bench sweeps.
test('deep-nested depth 8 × 50KB/level: at-depth typing (report-only)', async ({ page }) => {
	const editor = new EditorPage(page);
	const m = await measureDeepNestedTyping(page, editor, 8, 50_000, 30);
	writeResult('deep-nested-d8-50KB', 'at-depth', {
		shape: 'deep-nested',
		depth: 8,
		bytesPerLevel: 50_000,
		loadMs: round(m.loadMs),
		keystrokes: 30,
		keystrokeP50Ms: round(m.p50Ms),
		keystrokeP95Ms: round(m.p95Ms),
		rendersPerKeystroke: m.rendersPerKeystroke,
		rebuildDepths: m.rebuildDepths,
		note: DEV_CAVEAT
	});
	expect(m.samples).toHaveLength(30);
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
	// The edited block's inline recompute rides the debounced input flush
	// (~250ms after the keystroke), so poll the snapshot rather than reading it
	// immediately.
	await page.waitForFunction(
		() => (window as any).__test.perf.snapshot().inlineComputeCount >= 1,
		null,
		{ timeout: 5_000, polling: 16 }
	);
	const snapshot = await page.evaluate(() => (window as any).__test.perf.snapshot());
	expect(snapshot.inlineComputeCount).toBeGreaterThanOrEqual(1);
});
