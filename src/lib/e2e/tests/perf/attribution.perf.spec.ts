import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { generateUniformBlocks, generateFixture } from '../../../test/perf/fixtures/generate';
import {
	docLengthInPage,
	waitForDocLength,
	waitForBlock0Len,
	percentileMs,
	writePerfResult
} from './latency-harness';

declare const process: { env: Record<string, string | undefined> };
// Diagnostic instruments that gate nothing, so the gate run skips them. The rule lives
// here rather than in a caller's `--grep-invert`, so local and CI run the same row set.
test.skip(
	!process.env.PERF || !!process.env.PERF_GATE,
	'report-only — run via `npm run perf:e2e`; the perf:check gate skips these'
);

test('perf bridge: a keystroke records a block render and an in-page sample', async ({ page }) => {
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent('hello world\n');
	await armPerf(page);
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

/** Block 0's serialized length, the O(1) settle target: an interior keystroke reaches it
 *  through the ancestry rebuild, and summing every child would dwarf what is measured. */
async function block0Len(page: Page): Promise<number> {
	return page.evaluate(() => {
		const c = (window as any).__test.getDocument().children[0];
		return c.leadingTrivia.length + c.raw.length;
	});
}

interface DurationDeltaMs {
	scriptMs: number;
	layoutMs: number;
	recalcStyleMs: number;
	taskMs: number;
}

// One CDP measurement window shared by every axis. Whatever must stay OUTSIDE the window
// (perf.enable/reset, goto, post-run snapshot reads) lives around the `run` closure.
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
	writePerfResult(`ATTR ${name}`, `attr-${name}`, result);
}

/** Arm the in-page instruments for a fresh window: enable is sticky, reset is what makes the
 *  snapshot read only what follows. */
async function armPerf(page: Page): Promise<void> {
	await page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});
}

/** N keystrokes, each timed to the settle the axis reads its rows from. */
async function timedKeystrokes(
	editor: EditorPage,
	keystrokes: number,
	settleAt: (i: number) => Promise<void>
): Promise<number[]> {
	const harness: number[] = [];
	for (let i = 1; i <= keystrokes; i++) {
		const t0 = performance.now();
		await editor.typeSlowly('x');
		await settleAt(i);
		harness.push(performance.now() - t0);
	}
	return harness;
}

// Block 0 is the only block guaranteed mounted under windowing. Focusing the LAST block of
// a windowing-scale fixture silently no-ops — its host is unmounted, so the keystroke lands
// on <body> and the settle hangs to timeout. Container fixtures must PREPEND a prose
// paragraph so block 0 is editable. Mirrors latency-harness.ts's block-0 target.
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
		await armPerf(page);
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
	await armPerf(page);
	const N = 20;
	const harness = await timedKeystrokes(editor, N, (i) => settle(page, base + i));
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
		await loadAndFocusBlock0(page, editor, src);
		const base = await page.evaluate(docLengthInPage);
		await armPerf(page);
		const N = 20;
		const harness = await timedKeystrokes(editor, N, (i) => settle(page, base + i));
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
	await armPerf(page);
	const harness: number[] = [];
	const N = 20;
	const { scriptMs, layoutMs, recalcStyleMs } = await cdpDurationDelta(page, async () => {
		const base = await page.evaluate(docLengthInPage);
		harness.push(...(await timedKeystrokes(editor, N, (i) => settle(page, base + i))));
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
	await armPerf(page);
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
		harness.push(...(await timedKeystrokes(editor, N, (i) => settle(page, base + i))));
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
		await loadAndFocusBlock0(page, editor, src);
		let b0 = await block0Len(page);
		await editor.typeSlowly('x'); // warm up past the first-edit re-render
		await waitForBlock0Len(page, b0 + 1, 60_000);
		b0 += 1;
		await armPerf(page);
		// CDP ScriptDuration is the airtight measure: immune to where the in-page mark and
		// the block-0 poll each fire, and with the O(1) settle the poll script is negligible.
		const harness: number[] = [];
		const N = 10;
		const delta = await cdpDurationDelta(page, async () => {
			harness.push(
				...(await timedKeystrokes(editor, N, (i) => waitForBlock0Len(page, b0 + i, 60_000)))
			);
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
// Separates the two candidate causes of a slow flat load — first-render-mounts-all vs
// O(count) tree materialization — via mounted-vs-child count and the CDP script/layout split.
test('axisLoad: flat load mounted-count + script/layout split', async ({ page }) => {
	const editor = new EditorPage(page);
	const rows: object[] = [];
	for (const bytes of [1_000_000, 4_000_000, 10_000_000]) {
		const src = generateFixture('many-small-blocks', bytes);
		await editor.goto();
		await armPerf(page);
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
// The LRD resolver is reassigned only on a real signature change, so the first edit after
// load must not fan out into a full-document re-render.

test('axisT: first-edit full instrument profile (nested 1MB)', async ({ page }) => {
	const editor = new EditorPage(page);
	const src = 'perf cursor target\n\n' + generateFixture('nested-containers', 1_000_000);
	await loadAndFocusBlock0(page, editor, src);
	const base = await page.evaluate(docLengthInPage);
	await armPerf(page);
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
	// A document-wide fan-out reads in the tens of thousands here, so the generous bound
	// still catches a regression back to one.
	expect(s.blockRenderCount).toBeLessThanOrEqual(50);
});

// ── Axis I: container-interior direct attribution ───────────────────────────
// The axis no other row here can see: every one of them prepends a prose target and types
// AHEAD of the container, so none has ever measured a keystroke from inside one.

const INTERIOR_LEAF_PATHS = [
	[0, 0, 0],
	[0, 20, 0]
];

/** A leaf the container windowed out takes the keystroke on `<body>`, so the settle hangs to
 *  timeout instead of reporting. Mirrors loadAndFocusBlock0's block-0 check. */
async function assertLeafMounted(page: Page, leafPath: number[]): Promise<void> {
	const attr = JSON.stringify(leafPath);
	const mounted = await page.evaluate(
		(a) => document.querySelector(`[data-block-path='${a}']`) !== null,
		attr
	);
	if (!mounted) throw new Error(`interior target ${attr} is off-window — windowing unmounted it`);
}

/** One interior arm: focus the leaf, absorb the first-edit re-render, then time keystrokes
 *  inside a single CDP window. Leaves the caret and the grown document for the next arm. */
async function measureInteriorArm(
	page: Page,
	editor: EditorPage,
	leafPath: number[]
): Promise<object> {
	await assertLeafMounted(page, leafPath);
	// Overshooting the leaf's length lands in focusBlockAtPath's clamp-to-end fallback, so
	// the caret sits at that leaf's end whatever its content is.
	await editor.focusBlockAtPath(leafPath, Number.MAX_SAFE_INTEGER);

	const WARMUP = 2;
	let b0 = await block0Len(page);
	for (let i = 1; i <= WARMUP; i++) {
		await editor.typeSlowly('x');
		await waitForBlock0Len(page, b0 + i, 60_000);
	}
	b0 += WARMUP;

	await armPerf(page);
	const harness: number[] = [];
	const N = 10;
	const delta = await cdpDurationDelta(page, async () => {
		harness.push(
			...(await timedKeystrokes(editor, N, (i) => waitForBlock0Len(page, b0 + i, 60_000)))
		);
	});
	const snap = await page.evaluate(() => (window as any).__test.perf.snapshot());
	return {
		leafPath: JSON.stringify(leafPath),
		keystrokes: N,
		harnessP50Ms: Math.round(p50(harness)),
		inPageP50Ms: snap.keystrokeInPageMs.length
			? Math.round(p50(snap.keystrokeInPageMs) * 10) / 10
			: null,
		scriptMsPerKey: Math.round((delta.scriptMs * 10) / N) / 10,
		layoutMsPerKey: Math.round((delta.layoutMs * 10) / N) / 10,
		recalcStyleMsPerKey: Math.round((delta.recalcStyleMs * 10) / N) / 10,
		rebuildDepths: snap.rebuildDepths,
		parseCount: snap.parseCount,
		snapshotCount: snap.snapshotCount,
		blockRenderCount: snap.blockRenderCount,
		formatCoverageReads: snap.formatCoverageReads
	};
}

test('axisI: container-interior direct attribution (giant list 1MB)', async ({ page }) => {
	const editor = new EditorPage(page);
	// No prose target: block 0 IS the list, which is what puts the caret inside a container
	// and still leaves the block-0 settle reading the ancestry rebuild.
	const src = generateFixture('giant-single-list', 1_000_000);
	await editor.goto();
	await page.evaluate((c) => (window as any).__test.setSource(c), src);
	await settle(page, src.replace(/\s+$/, '').length);
	await editor.waitForRenderFlush();

	// Both arms checked before either runs: a mid-leaf miss after the head arm's minute of
	// keystrokes would fail the test having written no row at all.
	for (const leafPath of INTERIOR_LEAF_PATHS) await assertLeafMounted(page, leafPath);

	// Head and mid on one loaded document, so the pair differs only in where the caret sits.
	const rows: object[] = [];
	for (const leafPath of INTERIOR_LEAF_PATHS) {
		rows.push(await measureInteriorArm(page, editor, leafPath));
	}
	write('axisI-interior', { rows });
	expect(rows).toHaveLength(2);
});
