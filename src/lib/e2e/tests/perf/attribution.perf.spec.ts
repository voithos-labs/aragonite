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
// Diagnostic rows that gate nothing, so the gate run skips them. The rule sits here rather
// than in a caller's `--grep-invert`, so a local run and CI cover the same rows.
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

/** Block 0's serialized length, which the wait polls: a keystroke inside it reaches this
 *  through the rebuild up to the root, and summing every child would cost more than is
 *  being measured. */
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

// One CDP measurement window shared by every row. Anything that must stay outside it
// (perf.enable and reset, goto, reading the snapshot afterwards) sits around the `run`.
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

/** Prepare the in-page counters for a new window: enabling them sticks, and the reset is what
 *  makes the snapshot cover only what comes after. */
async function armPerf(page: Page): Promise<void> {
	await page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});
}

/** N keystrokes, each timed to the wait this row reports from. */
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

// Block 0 is the only block windowing always keeps mounted. Focusing the last block of a
// large fixture quietly does nothing, since its host is unmounted, so the keystroke lands on
// <body> and the wait runs to timeout. A fixture whose first block is a container has to put a
// prose paragraph in front, so block 0 is editable, as latency-harness.ts does.
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
	const editedIndex = 0; // loadAndFocusBlock0 focuses the prose block put in front
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
	await editor.typeSlowly('x'); // warm up past the one full re-render
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
		await editor.typeSlowly('x'); // warm up past the re-render on the first edit
		await waitForBlock0Len(page, b0 + 1, 60_000);
		b0 += 1;
		await armPerf(page);
		// CDP's ScriptDuration is the measure that cannot be argued with: it does not depend on
		// when the in-page marks fire, and the cheap wait makes the polling script negligible.
		const harness: number[] = [];
		const N = 10;
		const delta = await cdpDurationDelta(page, async () => {
			harness.push(
				...(await timedKeystrokes(editor, N, (i) => waitForBlock0Len(page, b0 + i, 60_000)))
			);
		});
		// The number of mounted top-level hosts, counted in the DOM, so it does not depend on
		// when the counters were enabled: mountedBlockCount needs enabling before any mount.
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

// ── Axis Load: where the time goes on a slow load ───────────────────────────
// Tells the two possible causes of a slow flat load apart, mounting every block on the first
// render or building a tree that costs per block, by comparing mounted blocks against total
// children and splitting the CDP time into scripting and layout.
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

// ── Axis T: every counter on the first edit, against axis R's steady state ──
// The link-definition resolver is replaced only when the definitions really change, so the
// first edit after a load must not re-render the whole document.

test('axisT: first-edit full instrument profile (nested 1MB)', async ({ page }) => {
	const editor = new EditorPage(page);
	const src = 'perf cursor target\n\n' + generateFixture('nested-containers', 1_000_000);
	await loadAndFocusBlock0(page, editor, src);
	const base = await page.evaluate(docLengthInPage);
	await armPerf(page);
	await editor.typeSlowly('x'); // the first edit after the load
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
	// Re-rendering the whole document reads in the tens of thousands here, so even this
	// generous limit catches a regression back to that.
	expect(s.blockRenderCount).toBeLessThanOrEqual(50);
});

// ── Axis I: typing inside a container ───────────────────────────────────────
// What no other row here can see: every one of them puts a prose block in front and types
// before the container, so none has ever measured a keystroke from inside one.

const INTERIOR_LEAF_PATHS = [
	[0, 0, 0],
	[0, 20, 0]
];

/** A child the container unmounted takes the keystroke on `<body>`, so the wait runs to
 *  timeout instead of reporting, the same check loadAndFocusBlock0 makes. */
async function assertLeafMounted(page: Page, leafPath: number[]): Promise<void> {
	const attr = JSON.stringify(leafPath);
	const mounted = await page.evaluate(
		(a) => document.querySelector(`[data-block-path='${a}']`) !== null,
		attr
	);
	if (!mounted) throw new Error(`interior target ${attr} is off-window — windowing unmounted it`);
}

/** One run inside a container: focus the child, let the first edit's re-render pass, then
 *  time keystrokes in a single CDP window. Leaves the caret and the document for the next. */
async function measureInteriorArm(
	page: Page,
	editor: EditorPage,
	leafPath: number[]
): Promise<object> {
	await assertLeafMounted(page, leafPath);
	// Asking for an offset past the child's length falls back to the end in focusBlockAtPath,
	// so the caret sits at that child's end whatever it contains.
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
	// No prose block in front: block 0 is the list itself, which puts the caret inside a
	// container while the wait on block 0 still sees the rebuild reach the root.
	const src = generateFixture('giant-single-list', 1_000_000);
	await editor.goto();
	await page.evaluate((c) => (window as any).__test.setSource(c), src);
	await settle(page, src.replace(/\s+$/, '').length);
	await editor.waitForRenderFlush();

	// Both targets are checked before either runs: missing the second one after a minute of
	// keystrokes on the first would fail the test with no row written at all.
	for (const leafPath of INTERIOR_LEAF_PATHS) await assertLeafMounted(page, leafPath);

	// Both positions on one loaded document, so the pair differs only in where the caret is.
	const rows: object[] = [];
	for (const leafPath of INTERIOR_LEAF_PATHS) {
		rows.push(await measureInteriorArm(page, editor, leafPath));
	}
	write('axisI-interior', { rows });
	expect(rows).toHaveLength(2);
});
