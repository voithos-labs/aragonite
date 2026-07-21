import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { EditorPage } from '../../editor-page';
import { generateUniformBlocks, generateFixture } from '../../../test/perf/fixtures/generate';
import {
	docLengthInPage,
	waitForDocLength,
	waitForBlock0Len,
	percentileMs
} from './latency-harness';

declare const process: { env: Record<string, string | undefined> };
test.skip(!process.env.PERF, 'set PERF=1 to run the perf project');

test('perf bridge: a keystroke records a block render and an in-page sample', async ({ page }) => {
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
	await page.waitForFunction(
		() => (window as any).__test.perf.snapshot().blockRenderCount >= 1,
		null,
		{
			timeout: 5_000,
			polling: 16
		}
	);
	const snap = await page.evaluate(() => (window as any).__test.perf.snapshot());
	expect(snap.blockRenderCount).toBeGreaterThanOrEqual(1);
	expect(snap.keystrokeInPageMs.length).toBeGreaterThanOrEqual(1);
});

// ── Shared helpers ──────────────────────────────────────────────────────────

async function settle(page: Page, min: number): Promise<void> {
	await waitForDocLength(page, min, 60_000);
}

const p50 = (xs: number[]): number => percentileMs(xs, 50);

interface DurationDeltaMs {
	scriptMs: number;
	layoutMs: number;
	recalcStyleMs: number;
	taskMs: number;
}

// One CDP measurement window shared by every CDP axis: snapshot the Performance
// counters, run the timed work, and return the *Duration deltas in ms. Whatever
// must stay outside the window (perf.enable/reset, goto, post-run snapshot reads)
// lives around the `run` closure, never inside the helper.
async function cdpDurationDelta(page: Page, run: () => Promise<void>): Promise<DurationDeltaMs> {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Performance.enable');
	const metric = (m: any, n: string): number =>
		m.metrics.find((x: any) => x.name === n)?.value ?? 0;
	const before: any = await cdp.send('Performance.getMetrics');
	await run();
	const after: any = await cdp.send('Performance.getMetrics');
	const deltaMs = (n: string): number => (metric(after, n) - metric(before, n)) * 1000;
	return {
		scriptMs: deltaMs('ScriptDuration'),
		layoutMs: deltaMs('LayoutDuration'),
		recalcStyleMs: deltaMs('RecalcStyleDuration'),
		taskMs: deltaMs('TaskDuration')
	};
}

function write(name: string, result: object): void {
	const line = JSON.stringify(result);
	console.log(`ATTR ${name} ${line}`);
	mkdirSync('perf-results', { recursive: true });
	writeFileSync(`perf-results/attr-${name}.json`, line + '\n');
}

// Focus block 0 — the only block guaranteed mounted once windowing unmounts
// off-screen blocks (scrollTop=0 keeps the top in-window). Focusing the LAST
// block of a windowing-scale fixture silently no-ops: its DOM host is unmounted,
// so the keystroke lands on <body>, docLengthInPage never advances, and the
// per-keystroke settle hangs to timeout. Container-shaped fixtures must PREPEND a
// prose paragraph so block 0 is an editable prose target. Mirrors
// latency-harness.ts's block-0 target and axisS below.
async function loadAndFocusBlock0(page: Page, editor: EditorPage, src: string): Promise<void> {
	await editor.goto();
	await page.evaluate((c) => (window as any).__test.setSource(c), src);
	await settle(page, src.replace(/\s+$/, '').length);
	await editor.waitForRenderFlush();
	await editor.focusBlockEnd(0);
	const mounted = await page.evaluate(
		() => document.querySelector(`[data-block-path='[0]']`) !== null
	);
	if (!mounted) throw new Error('perf target block 0 is off-window — windowing unmounted it');
}

// ── Axis 1: fan-out ─────────────────────────────────────────────────────────

test('axis1: renders-per-keystroke vs block count', async ({ page }) => {
	const editor = new EditorPage(page);
	const rows: object[] = [];
	for (const blockCount of [100, 1000, 5000]) {
		const src = generateUniformBlocks(blockCount, 4) + '\nperf cursor target\n';
		await loadAndFocusBlock0(page, editor, src);
		const base = await page.evaluate(docLengthInPage);
		await page.evaluate(() => {
			(window as any).__test.perf.enable();
			(window as any).__test.perf.reset();
		});
		await editor.typeSlowly('x');
		await settle(page, base + 1);
		const snap = await page.evaluate(() => (window as any).__test.perf.snapshot());
		rows.push({
			blockCount,
			blockRenderCount: snap.blockRenderCount,
			blockRenderMsTotal: snap.blockRenderMsTotal
		});
	}
	write('axis1-fanout', { rows });
	expect(rows).toHaveLength(3);
});

// ── Axis 3: scripting vs layout split (CDP) ─────────────────────────────────

test('axis3: scripting vs layout split', async ({ page }) => {
	const editor = new EditorPage(page);
	const src = generateUniformBlocks(2000, 8) + '\nperf cursor target\n';
	await loadAndFocusBlock0(page, editor, src);
	const N = 20;
	const { scriptMs, layoutMs, recalcStyleMs } = await cdpDurationDelta(page, async () => {
		const base = await page.evaluate(docLengthInPage);
		for (let i = 1; i <= N; i++) {
			await editor.typeSlowly('x');
			await settle(page, base + i);
		}
	});
	write('axis3-cdp', {
		keystrokes: N,
		scriptMs,
		layoutMs,
		recalcStyleMs
	});
});

// ── Axis 4: harness overhead ────────────────────────────────────────────────

test('axis4: in-page settle vs harness latency', async ({ page }) => {
	const editor = new EditorPage(page);
	const src = generateUniformBlocks(1000, 6) + '\nperf cursor target\n';
	await loadAndFocusBlock0(page, editor, src);
	const base = await page.evaluate(docLengthInPage);
	await page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});
	const harness: number[] = [];
	const N = 20;
	for (let i = 1; i <= N; i++) {
		const t0 = performance.now();
		await editor.typeSlowly('x');
		await settle(page, base + i);
		harness.push(performance.now() - t0);
	}
	const snap = await page.evaluate(() => (window as any).__test.perf.snapshot());
	write('axis4-harness', {
		harnessP50Ms: p50(harness),
		inPageP50Ms: p50(snap.keystrokeInPageMs),
		inPageSamples: snap.keystrokeInPageMs.length
	});
});

// ── Axis 5: intra-block ─────────────────────────────────────────────────────

test('axis5: latency vs single-paragraph length', async ({ page }) => {
	const editor = new EditorPage(page);
	const rows: object[] = [];
	for (const bytes of [50_000, 200_000, 800_000]) {
		const src = generateFixture('single-giant-paragraph', bytes);
		await editor.goto();
		await page.evaluate((c) => (window as any).__test.setSource(c), src);
		await settle(page, src.replace(/\s+$/, '').length);
		await editor.waitForRenderFlush();
		await editor.focusBlockEnd(0);
		const base = await page.evaluate(docLengthInPage);
		await page.evaluate(() => {
			(window as any).__test.perf.enable();
			(window as any).__test.perf.reset();
		});
		const harness: number[] = [];
		const N = 20;
		for (let i = 1; i <= N; i++) {
			const t0 = performance.now();
			await editor.typeSlowly('x');
			await settle(page, base + i);
			harness.push(performance.now() - t0);
		}
		const snap = await page.evaluate(() => (window as any).__test.perf.snapshot());
		rows.push({ bytes, p50Ms: p50(harness), blockRenderMsTotal: snap.blockRenderMsTotal });
	}
	write('axis5-intrablock', { rows });
	expect(rows).toHaveLength(3);
});

// ── Axis N: nested-containers headline direct attribution ───────────────────

test('axisN: nested-containers 1MB direct attribution', async ({ page }) => {
	const editor = new EditorPage(page);
	const src = 'perf cursor target\n\n' + generateFixture('nested-containers', 1_000_000);
	await loadAndFocusBlock0(page, editor, src);
	await page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});
	const harness: number[] = [];
	const N = 20;
	const { scriptMs, layoutMs, recalcStyleMs } = await cdpDurationDelta(page, async () => {
		const base = await page.evaluate(docLengthInPage);
		for (let i = 1; i <= N; i++) {
			const t0 = performance.now();
			await editor.typeSlowly('x');
			await settle(page, base + i);
			harness.push(performance.now() - t0);
		}
	});
	const snap = await page.evaluate(() => (window as any).__test.perf.snapshot());
	write('axisN-nested', {
		keystrokes: N,
		harnessP50Ms: p50(harness),
		inPageP50Ms: p50(snap.keystrokeInPageMs),
		blockRenderCount: snap.blockRenderCount,
		blockRenderMsTotal: snap.blockRenderMsTotal,
		scriptMs,
		layoutMs,
		recalcStyleMs
	});
});

// ── Axis M: which blocks re-render (mechanism confirmation) ──────────────────

test('axisM: which blocks re-render on one keystroke (nested 1MB)', async ({ page }) => {
	const editor = new EditorPage(page);
	const src = 'perf cursor target\n\n' + generateFixture('nested-containers', 1_000_000);
	await loadAndFocusBlock0(page, editor, src);
	const editedIndex = 0; // loadAndFocusBlock0 focuses the prepended prose block 0
	const base = await page.evaluate(docLengthInPage);
	await page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});
	await editor.typeSlowly('x');
	await settle(page, base + 1);
	const paths: string[] = await page.evaluate(
		() => (window as any).__test.perf.snapshot().blockRenderPaths
	);

	const topLevel = new Map<string, number>();
	const depth = new Map<number, number>();
	for (const p of paths) {
		const segs = p.split(',');
		topLevel.set(segs[0], (topLevel.get(segs[0]) ?? 0) + 1);
		depth.set(segs.length, (depth.get(segs.length) ?? 0) + 1);
	}
	write('axisM-which-blocks', {
		editedIndex,
		total: paths.length,
		distinct: new Set(paths).size,
		editedBlockRenders: paths.filter((p) => p === String(editedIndex)).length,
		distinctTopLevelSubtrees: topLevel.size,
		depthHistogram: Object.fromEntries([...depth].sort((a, b) => a[0] - b[0])),
		topRenderers: [...topLevel].sort((a, b) => b[1] - a[1]).slice(0, 5)
	});
	expect(paths.length).toBeGreaterThan(0);
});

// ── Axis P: per-keystroke render + latency distribution ─────────────────────

test('axisP: per-keystroke distribution (nested 1MB)', async ({ page }) => {
	const editor = new EditorPage(page);
	const src = 'perf cursor target\n\n' + generateFixture('nested-containers', 1_000_000);
	await loadAndFocusBlock0(page, editor, src);
	let base = await page.evaluate(docLengthInPage);
	await page.evaluate(() => (window as any).__test.perf.enable());
	const rows: object[] = [];
	for (let i = 0; i < 6; i++) {
		await page.evaluate(() => (window as any).__test.perf.reset());
		const t0 = performance.now();
		await editor.typeSlowly('x');
		await settle(page, base + 1);
		const harnessMs = performance.now() - t0;
		base += 1;
		const snap = await page.evaluate(() => (window as any).__test.perf.snapshot());
		rows.push({
			renders: snap.blockRenderCount,
			inPageMs: snap.keystrokeInPageMs[0] ?? null,
			harnessMs: Math.round(harnessMs)
		});
	}
	write('axisP-per-keystroke', { rows });
	expect(rows.length).toBe(6);
});

// ── Axis Q: steady-state CDP breakdown (post-warmup) ────────────────────────

test('axisQ: steady-state CDP breakdown (nested 1MB)', async ({ page }) => {
	const editor = new EditorPage(page);
	const src = 'perf cursor target\n\n' + generateFixture('nested-containers', 1_000_000);
	await loadAndFocusBlock0(page, editor, src);
	let base = await page.evaluate(docLengthInPage);
	// Warm up past the one-time full-document re-render.
	await editor.typeSlowly('x');
	await settle(page, base + 1);
	base += 1;
	const harness: number[] = [];
	const N = 15;
	const delta = await cdpDurationDelta(page, async () => {
		for (let i = 1; i <= N; i++) {
			const t0 = performance.now();
			await editor.typeSlowly('x');
			await settle(page, base + i);
			harness.push(performance.now() - t0);
		}
	});
	write('axisQ-steadystate-cdp', {
		keystrokes: N,
		harnessP50Ms: p50(harness),
		taskMsPerKey: delta.taskMs / N,
		scriptMsPerKey: delta.scriptMs / N,
		layoutMsPerKey: delta.layoutMs / N,
		recalcStyleMsPerKey: delta.recalcStyleMs / N
	});
	expect(harness.length).toBe(N);
});

// ── Axis R: steady-state existing-instrument breakdown ──────────────────────

test('axisR: steady-state instrument breakdown (nested 1MB)', async ({ page }) => {
	const editor = new EditorPage(page);
	const src = 'perf cursor target\n\n' + generateFixture('nested-containers', 1_000_000);
	await loadAndFocusBlock0(page, editor, src);
	let base = await page.evaluate(docLengthInPage);
	await page.evaluate(() => (window as any).__test.perf.enable());
	await editor.typeSlowly('x'); // warm up past the one-time full re-render
	await settle(page, base + 1);
	base += 1;
	const rows: object[] = [];
	for (let i = 0; i < 4; i++) {
		await page.evaluate(() => (window as any).__test.perf.reset());
		await editor.typeSlowly('x');
		await settle(page, base + 1);
		base += 1;
		const s = await page.evaluate(() => (window as any).__test.perf.snapshot());
		rows.push({
			renders: s.blockRenderCount,
			parseCount: s.parseCount,
			parseMs: Math.round(s.parseMsTotal),
			parseBlockCount: s.parseBlockCount,
			inlineComputeCount: s.inlineComputeCount,
			snapshotCount: s.snapshotCount,
			rebuildDepths: s.rebuildDepths
		});
	}
	write('axisR-instruments', { rows });
	expect(rows.length).toBe(4);
});

// ── Axis S: steady-state latency vs flat (non-nested) block count ────────────

test('axisS: steady-state latency vs flat block count', async ({ page }) => {
	const editor = new EditorPage(page);
	const rows: object[] = [];
	for (const blockCount of [1000, 10000, 30000]) {
		const src = generateUniformBlocks(blockCount, 4) + '\nperf cursor target\n';
		// Type into block 0 (top, always in-window). Focusing the LAST block fails
		// once windowing activates and unmounts it — and matches the gated harness,
		// which also edits block 0.
		await editor.goto();
		await page.evaluate((c) => (window as any).__test.setSource(c), src);
		await settle(page, src.replace(/\s+$/, '').length);
		await editor.waitForRenderFlush();
		await editor.focusBlockEnd(0);
		let b0 = await page.evaluate(() => {
			const c = (window as any).__test.getDocument().children[0];
			return c.leadingTrivia.length + c.raw.length;
		});
		await editor.typeSlowly('x'); // warm up past the first-edit re-render
		await waitForBlock0Len(page, b0 + 1, 60_000);
		b0 += 1;
		await page.evaluate(() => {
			(window as any).__test.perf.enable();
			(window as any).__test.perf.reset();
		});
		// CDP ScriptDuration/keystroke is the airtight measure: immune to both the
		// in-page mark (fires at the edited block's render effect) and the block-0
		// poll (resolves at the synchronous commit). With the O(1) settle the poll
		// script is negligible, so flat ScriptDuration ⇒ editor work is provably flat.
		const harness: number[] = [];
		const N = 10;
		const delta = await cdpDurationDelta(page, async () => {
			for (let i = 1; i <= N; i++) {
				const t0 = performance.now();
				await editor.typeSlowly('x');
				await waitForBlock0Len(page, b0 + i, 60_000);
				harness.push(performance.now() - t0);
			}
		});
		// Mounted top-level host count from the DOM — robust to perf-enable timing
		// (the net mountedBlockCount counter needs enabling before any block mounts).
		const mountedTopLevel = await page.evaluate(
			() => document.querySelectorAll('[data-block-path]:not([data-block-path*=","])').length
		);
		const snap = await page.evaluate(() => (window as any).__test.perf.snapshot());
		rows.push({
			blockCount,
			p50Ms: Math.round(p50(harness)),
			inPageP50Ms: snap.keystrokeInPageMs.length
				? Math.round(p50(snap.keystrokeInPageMs) * 10) / 10
				: null,
			scriptMsPerKey: Math.round((delta.scriptMs * 10) / N) / 10,
			mountedTopLevel,
			rendersPerKeystroke: Math.round((snap.blockRenderCount / N) * 100) / 100
		});
	}
	write('axisS-flatcount', { rows });
	expect(rows.length).toBe(3);
});

// ── Axis Load: flat load-cliff attribution ──────────────────────────────────
// The ~23s many-small-blocks-10MB load: first-render-mounts-all, or O(count) tree
// materialization? mountedTopLevel (DOM, robust) vs topLevelChildCount + the CDP
// script/layout split answer it. Load settle stays O(count) — it's a one-time
// poll, dwarfed by the load it waits on.
test('axisLoad: flat load mounted-count + script/layout split', async ({ page }) => {
	const editor = new EditorPage(page);
	const rows: object[] = [];
	for (const bytes of [1_000_000, 4_000_000, 10_000_000]) {
		const src = generateFixture('many-small-blocks', bytes);
		await editor.goto();
		await page.evaluate(() => {
			(window as any).__test.perf.enable();
			(window as any).__test.perf.reset();
		});
		let loadMs = 0;
		const { scriptMs, layoutMs } = await cdpDurationDelta(page, async () => {
			const t0 = performance.now();
			await page.evaluate((c) => (window as any).__test.setSource(c), src);
			await settle(page, src.replace(/\s+$/, '').length);
			await editor.waitForRenderFlush();
			loadMs = performance.now() - t0;
		});
		const mountedTopLevel = await page.evaluate(
			() => document.querySelectorAll('[data-block-path]:not([data-block-path*=","])').length
		);
		const topLevelChildCount = await page.evaluate(
			() => (window as any).__test.getDocument().children.length
		);
		const snap = await page.evaluate(() => (window as any).__test.perf.snapshot());
		rows.push({
			bytes,
			loadMs: Math.round(loadMs),
			topLevelChildCount,
			mountedTopLevel,
			rendersDuringLoad: snap.blockRenderCount,
			scriptMs: Math.round(scriptMs),
			layoutMs: Math.round(layoutMs)
		});
	}
	write('axisLoad-flat', { rows });
	expect(rows).toHaveLength(3);
});

// ── Axis T: first-edit full instrument profile (vs steady-state axisR) ───────
// The one-time first-edit full-document re-render is fixed — the LRD resolver is
// reassigned only on a real signature change, so the first edit no longer
// re-renders every block. This capture confirms it: renders stays bounded, not ~22k.

test('axisT: first-edit full instrument profile (nested 1MB)', async ({ page }) => {
	const editor = new EditorPage(page);
	const src = 'perf cursor target\n\n' + generateFixture('nested-containers', 1_000_000);
	await loadAndFocusBlock0(page, editor, src);
	const base = await page.evaluate(docLengthInPage);
	await page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});
	await editor.typeSlowly('x'); // the FIRST edit after load
	await settle(page, base + 1);
	const s = await page.evaluate(() => (window as any).__test.perf.snapshot());
	write('axisT-first-edit', {
		renders: s.blockRenderCount,
		parseCount: s.parseCount,
		parseBlockCount: s.parseBlockCount,
		inlineComputeCount: s.inlineComputeCount,
		snapshotCount: s.snapshotCount,
		rebuildDepths: s.rebuildDepths
	});
	// Pre-fix this was ~21,980 (the whole document). Post-fix the first edit
	// re-renders only the edited block; the generous bound still catches any
	// regression back toward a document-wide fan-out.
	expect(s.blockRenderCount).toBeLessThanOrEqual(50);
});
