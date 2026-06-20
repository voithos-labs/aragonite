import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { EditorPage } from '../../editor-page';
import { generateUniformBlocks, generateFixture } from '../../../test/perf/fixtures/generate';

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

function docLengthInPage(): number {
	const doc = (window as any).__test.getDocument();
	let length = doc.prefix.length + doc.suffix.length;
	for (const child of doc.children) length += child.leadingTrivia.length + child.raw.length;
	return length;
}

async function settle(page: Page, min: number): Promise<void> {
	await page.waitForFunction(
		({ fnSrc, min }) => (new Function(`return (${fnSrc})();`)() as number) >= min,
		{ fnSrc: docLengthInPage.toString(), min },
		{ timeout: 60_000, polling: 16 }
	);
}

function p50(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.max(0, Math.ceil(0.5 * s.length) - 1)];
}

function write(name: string, result: object): void {
	const line = JSON.stringify(result);
	console.log(`ATTR ${name} ${line}`);
	mkdirSync('perf-results', { recursive: true });
	writeFileSync(`perf-results/attr-${name}.json`, line + '\n');
}

async function loadAndFocusLast(page: Page, editor: EditorPage, src: string): Promise<void> {
	await editor.goto();
	await page.evaluate((c) => (window as any).__test.setSource(c), src);
	await settle(page, src.replace(/\s+$/, '').length);
	await editor.waitForRenderFlush();
	const last = await page.evaluate(() => (window as any).__test.getDocument().children.length - 1);
	await editor.focusBlockEnd(last);
}

// ── Axis 1: fan-out ─────────────────────────────────────────────────────────

test('axis1: renders-per-keystroke vs block count', async ({ page }) => {
	const editor = new EditorPage(page);
	const rows: object[] = [];
	for (const blockCount of [100, 1000, 5000]) {
		const src = generateUniformBlocks(blockCount, 4) + '\nperf cursor target\n';
		await loadAndFocusLast(page, editor, src);
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
	await loadAndFocusLast(page, editor, src);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Performance.enable');
	const metric = (m: any, n: string): number =>
		m.metrics.find((x: any) => x.name === n)?.value ?? 0;
	const before: any = await cdp.send('Performance.getMetrics');
	const base = await page.evaluate(docLengthInPage);
	const N = 20;
	for (let i = 1; i <= N; i++) {
		await editor.typeSlowly('x');
		await settle(page, base + i);
	}
	const after: any = await cdp.send('Performance.getMetrics');
	write('axis3-cdp', {
		keystrokes: N,
		scriptMs: (metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration')) * 1000,
		layoutMs: (metric(after, 'LayoutDuration') - metric(before, 'LayoutDuration')) * 1000,
		recalcStyleMs:
			(metric(after, 'RecalcStyleDuration') - metric(before, 'RecalcStyleDuration')) * 1000
	});
});

// ── Axis 4: harness overhead ────────────────────────────────────────────────

test('axis4: in-page settle vs harness latency', async ({ page }) => {
	const editor = new EditorPage(page);
	const src = generateUniformBlocks(1000, 6) + '\nperf cursor target\n';
	await loadAndFocusLast(page, editor, src);
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
	const src = generateFixture('nested-containers', 1_000_000) + '\nperf cursor target\n';
	await loadAndFocusLast(page, editor, src);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Performance.enable');
	const metric = (m: any, n: string): number =>
		m.metrics.find((x: any) => x.name === n)?.value ?? 0;
	await page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});
	const before: any = await cdp.send('Performance.getMetrics');
	const base = await page.evaluate(docLengthInPage);
	const harness: number[] = [];
	const N = 20;
	for (let i = 1; i <= N; i++) {
		const t0 = performance.now();
		await editor.typeSlowly('x');
		await settle(page, base + i);
		harness.push(performance.now() - t0);
	}
	const after: any = await cdp.send('Performance.getMetrics');
	const snap = await page.evaluate(() => (window as any).__test.perf.snapshot());
	write('axisN-nested', {
		keystrokes: N,
		harnessP50Ms: p50(harness),
		inPageP50Ms: p50(snap.keystrokeInPageMs),
		blockRenderCount: snap.blockRenderCount,
		blockRenderMsTotal: snap.blockRenderMsTotal,
		scriptMs: (metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration')) * 1000,
		layoutMs: (metric(after, 'LayoutDuration') - metric(before, 'LayoutDuration')) * 1000,
		recalcStyleMs:
			(metric(after, 'RecalcStyleDuration') - metric(before, 'RecalcStyleDuration')) * 1000
	});
});

// ── Axis M: which blocks re-render (mechanism confirmation) ──────────────────

test('axisM: which blocks re-render on one keystroke (nested 1MB)', async ({ page }) => {
	const editor = new EditorPage(page);
	const src = generateFixture('nested-containers', 1_000_000) + '\nperf cursor target\n';
	await loadAndFocusLast(page, editor, src);
	const editedIndex = await page.evaluate(
		() => (window as any).__test.getDocument().children.length - 1
	);
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
	const src = generateFixture('nested-containers', 1_000_000) + '\nperf cursor target\n';
	await loadAndFocusLast(page, editor, src);
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
	const src = generateFixture('nested-containers', 1_000_000) + '\nperf cursor target\n';
	await loadAndFocusLast(page, editor, src);
	let base = await page.evaluate(docLengthInPage);
	// Warm up past the one-time full-document re-render.
	await editor.typeSlowly('x');
	await settle(page, base + 1);
	base += 1;
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Performance.enable');
	const metric = (m: any, n: string): number =>
		m.metrics.find((x: any) => x.name === n)?.value ?? 0;
	const before: any = await cdp.send('Performance.getMetrics');
	const harness: number[] = [];
	const N = 15;
	for (let i = 1; i <= N; i++) {
		const t0 = performance.now();
		await editor.typeSlowly('x');
		await settle(page, base + i);
		harness.push(performance.now() - t0);
	}
	const after: any = await cdp.send('Performance.getMetrics');
	const per = (n: string) => ((metric(after, n) - metric(before, n)) * 1000) / N;
	write('axisQ-steadystate-cdp', {
		keystrokes: N,
		harnessP50Ms: p50(harness),
		taskMsPerKey: per('TaskDuration'),
		scriptMsPerKey: per('ScriptDuration'),
		layoutMsPerKey: per('LayoutDuration'),
		recalcStyleMsPerKey: per('RecalcStyleDuration')
	});
	expect(harness.length).toBe(N);
});

// ── Axis R: steady-state existing-instrument breakdown ──────────────────────

test('axisR: steady-state instrument breakdown (nested 1MB)', async ({ page }) => {
	const editor = new EditorPage(page);
	const src = generateFixture('nested-containers', 1_000_000) + '\nperf cursor target\n';
	await loadAndFocusLast(page, editor, src);
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
		await loadAndFocusLast(page, editor, src);
		let base = await page.evaluate(docLengthInPage);
		await editor.typeSlowly('x'); // warm up
		await settle(page, base + 1);
		base += 1;
		const harness: number[] = [];
		const N = 10;
		for (let i = 1; i <= N; i++) {
			const t0 = performance.now();
			await editor.typeSlowly('x');
			await settle(page, base + i);
			harness.push(performance.now() - t0);
		}
		base += N;
		rows.push({ blockCount, p50Ms: Math.round(p50(harness)) });
	}
	write('axisS-flatcount', { rows });
	expect(rows.length).toBe(3);
});

// ── Axis T: first-edit full instrument profile (vs steady-state axisR) ───────
// Cost #2 (the one-time first-edit full-document re-render) is now fixed — the
// LRD resolver is reassigned only on a real signature change, so the first edit
// no longer re-renders every block. This capture confirms that: renders is now
// bounded, not ~22k. Steady-state cost #1 (mounted-component flush) is unchanged
// and remains the VR (0.8.6) target.

test('axisT: first-edit full instrument profile (nested 1MB)', async ({ page }) => {
	const editor = new EditorPage(page);
	const src = generateFixture('nested-containers', 1_000_000) + '\nperf cursor target\n';
	await loadAndFocusLast(page, editor, src);
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
