# 0.8 Latency Attribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attribute the unexplained ~896ms-p50 keystroke latency (nested-containers 1MB, dev server) across named cost axes with reproducible, falsifiable numbers, then ship a ratified decision picking 0.8's next batch.

**Architecture:** Add poll-free instruments (per-keystroke block-render count + duration, in-page keystroke latency) to the existing `perf/instruments.ts`; add a uniform-block fixture generator; add a production-mode Playwright project for the gating prod-vs-dev measurement; add one diagnostic Playwright spec that captures the open axes (fan-out, render/layout split via CDP, harness overhead, intra-block). The owning session runs all timing captures **serially** (CLAUDE.md dispatch policy + noise discipline); only code-writing and trace-analysis fan out.

**Tech Stack:** Svelte 5, TypeScript, Vitest (unit + golden fixtures), Playwright (e2e perf, PERF-gated), Chrome DevTools Protocol (`Performance.getMetrics`).

**Spec:** `docs/perf/latency-attribution-spec.md`. **Companion (parked):** `docs/perf/perf-gate-ci-spec.md`.

**Two task kinds:** _Code tasks_ (1–4, 6) follow TDD. _Measurement tasks_ (5, 7) are protocols — they run captures, record numbers into a committed findings doc, and apply a confirm/falsify decision. Measurement steps show exact commands and what to record, not `assert ==`.

---

## File Structure

- `src/lib/editor/perf/instruments.ts` — **modify.** Add `blockRenderCount`, `blockRenderMsTotal`, `keystrokeInPageMs` to the snapshot; add `recordBlockRender`, `markKeystrokeStart`, `markKeystrokeSettle`.
- `src/lib/editor/test/perf/instruments.test.ts` — **modify.** Cover the new counters.
- `src/lib/editor/components/blocks/TextEditableBlock.svelte` — **modify.** Wire the render-timing + keystroke-bracket calls into the existing render `$effect` and `onInput`.
- `src/lib/editor/test/perf/fixtures/generate.ts` — **modify.** Add `generateUniformBlocks(blockCount, wordsPerBlock, seed?)`.
- `src/lib/editor/test/perf/fixtures/generate.test.ts` — **modify.** Golden-pin the new generator.
- `playwright.config.ts` — **modify.** Add a PERF_PROD-gated `e2e-perf-prod` project + preview webServer.
- `package.json` — **modify.** Add the `perf:e2e:prod` script.
- `src/lib/editor/e2e/tests/perf/attribution.perf.spec.ts` — **create.** The axis-capture diagnostic.
- `src/lib/editor/e2e/requirements/perf/attribution.md` — **create.** Requirement file (1:1 with the spec).
- `docs/perf/latency-attribution-findings.md` — **create.** Committed record of every captured number + the ratified decision.

---

## Task 1: Instruments — block-render + in-page-keystroke counters

**Files:**

- Modify: `src/lib/editor/perf/instruments.ts`
- Test: `src/lib/editor/test/perf/instruments.test.ts`

- [ ] **Step 1: Write the failing test.** Append to the `describe('perf instruments', …)` block in `instruments.test.ts`, and extend the shared `EMPTY` + `recordOneOfEach`:

```ts
// In the EMPTY constant, add the three new fields:
//   blockRenderCount: 0,
//   blockRenderMsTotal: 0,
//   keystrokeInPageMs: []
// In recordOneOfEach(), add:
//   recordBlockRender(2);
//   markKeystrokeStart();
//   markKeystrokeSettle();

it('records block renders while enabled', () => {
	enablePerfInstruments();
	recordBlockRender(2.5);
	recordBlockRender(1.5);
	const s = perfSnapshot();
	expect(s.blockRenderCount).toBe(2);
	expect(s.blockRenderMsTotal).toBeCloseTo(4);
});

it('records one in-page keystroke sample per start/settle pair', () => {
	enablePerfInstruments();
	markKeystrokeStart();
	markKeystrokeSettle();
	markKeystrokeSettle(); // no pending start → ignored
	const s = perfSnapshot();
	expect(s.keystrokeInPageMs).toHaveLength(1);
	expect(s.keystrokeInPageMs[0]).toBeGreaterThanOrEqual(0);
});

it('keystroke samples array is an independent copy', () => {
	enablePerfInstruments();
	markKeystrokeStart();
	markKeystrokeSettle();
	const first = perfSnapshot();
	first.keystrokeInPageMs.push(999);
	expect(perfSnapshot().keystrokeInPageMs).toHaveLength(1);
});
```

Add `recordBlockRender, markKeystrokeStart, markKeystrokeSettle` to the import block at the top of the test.

- [ ] **Step 2: Run the test, verify it fails.**

Run: `npm run test:editor:perf -- instruments`
Expected: FAIL — `recordBlockRender` / `markKeystrokeStart` not exported.

- [ ] **Step 3: Implement in `instruments.ts`.** Add the three fields to `PerfSnapshot` and `emptySnapshot()`, copy the array in `perfSnapshot()`, reset the start cursor, and add the recorders:

```ts
// In interface PerfSnapshot, after undoEntryCount:
	blockRenderCount: number;
	blockRenderMsTotal: number;
	keystrokeInPageMs: number[];

// In emptySnapshot(), after undoEntryCount: 0:
		blockRenderCount: 0,
		blockRenderMsTotal: 0,
		keystrokeInPageMs: []

// Replace perfSnapshot() so the array is copied too:
export function perfSnapshot(): PerfSnapshot {
	return {
		...counters,
		rebuildDepths: { ...counters.rebuildDepths },
		keystrokeInPageMs: [...counters.keystrokeInPageMs]
	};
}

// Add a module-level cursor next to `let counters`:
let keystrokeStart: number | null = null;

// In resetPerfInstruments(), after `counters = emptySnapshot();`:
	keystrokeStart = null;

// New recorders in the Recorders section:
export function recordBlockRender(ms: number): void {
	if (!enabled) return;
	counters.blockRenderCount++;
	counters.blockRenderMsTotal += ms;
}

export function markKeystrokeStart(): void {
	if (!enabled) return;
	keystrokeStart = performance.now();
}

export function markKeystrokeSettle(): void {
	if (!enabled || keystrokeStart === null) return;
	counters.keystrokeInPageMs.push(performance.now() - keystrokeStart);
	keystrokeStart = null;
}
```

- [ ] **Step 4: Run the test, verify it passes.**

Run: `npm run test:editor:perf -- instruments`
Expected: PASS (all instrument tests, including the pre-existing `records nothing while disabled` and `reset zeroes everything` now covering the new fields via the updated `EMPTY`/`recordOneOfEach`).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/editor/perf/instruments.ts src/lib/editor/test/perf/instruments.test.ts
git commit -m "+ (perf) block-render + in-page keystroke instruments"
```

---

## Task 2: Wire the counters into the render + input seams

**Files:**

- Modify: `src/lib/editor/components/blocks/TextEditableBlock.svelte`
- Test: `src/lib/editor/e2e/tests/perf/attribution.perf.spec.ts` (bridge-sanity test only; the rest of this spec is Task 6)

- [ ] **Step 1: Add the import** to TextEditableBlock's `<script>` (group with existing `../../` imports):

```ts
import {
	perfEnabled,
	recordBlockRender,
	markKeystrokeStart,
	markKeystrokeSettle
} from '../../perf/instruments';
```

- [ ] **Step 2: Bracket the render** — replace the body of the render `$effect` (the one calling `textRender.render(...)`):

```ts
$effect(() => {
	if (import.meta.env.DEV && ambientPrefixText && !isProseKind(node.kind)) {
		console.warn(
			`[TextEditableBlock] ambientPrefix is prose-only; non-prose kind ${node.kind} received a non-empty ambient prefix. The ambient marker will not render correctly.`
		);
	}

	const t0 = perfEnabled() ? performance.now() : 0;
	textRender.render({ forceRebuild: pendingCursorOffset !== null });
	if (perfEnabled()) recordBlockRender(performance.now() - t0);

	if (pendingCursorOffset !== null) {
		cursor.setRaw(pendingCursorOffset);
		pendingCursorOffset = null;
	}
	markKeystrokeSettle();
});
```

The `perfEnabled()` guard keeps the normal (perf-off) path to a single boolean check — no `performance.now()` cost in production, matching the existing instruments contract. `markKeystrokeSettle()` is internally guarded and no-ops unless a start is pending.

- [ ] **Step 3: Mark the keystroke start** — add `markKeystrokeStart()` as the first line of `onInput`:

```ts
function onInput(): void {
	markKeystrokeStart();
	stickyColumn.reset();
	lastSnapTargetOffset = null;
	if (composing || !el) return;
	// …unchanged…
}
```

- [ ] **Step 4: Write the bridge-sanity test.** Create `src/lib/editor/e2e/tests/perf/attribution.perf.spec.ts` with ONLY this test for now (Task 6 fills in the axis captures):

```ts
import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

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
```

Task 6 extends this import header when it adds the helpers and axis captures.

- [ ] **Step 5: Run the bridge-sanity test.** Requires the dev server (Playwright auto-starts it).

Run: `PERF=1 npx playwright test --project=e2e-perf attribution.perf -g "perf bridge"`
Expected: PASS — `blockRenderCount >= 1` and one `keystrokeInPageMs` sample.

- [ ] **Step 6: Verify behavior preservation.** The wiring must not perturb editing.

Run: `npm run test:e2e:top`
Expected: PASS (unchanged).

- [ ] **Step 7: Commit.**

```bash
git add src/lib/editor/components/blocks/TextEditableBlock.svelte src/lib/editor/e2e/tests/perf/attribution.perf.spec.ts
git commit -m "+ (perf) wire block-render + keystroke marks into the text surface"
```

---

## Task 3: Uniform-block fixture generator

**Files:**

- Modify: `src/lib/editor/test/perf/fixtures/generate.ts`
- Test: `src/lib/editor/test/perf/fixtures/generate.test.ts`

One generator serves both the block-count sweep (vary `blockCount`, fix `wordsPerBlock`) and the content-size sweep (fix `blockCount`, vary `wordsPerBlock`). The long-line sweep reuses the existing `single-giant-paragraph` shape — no new code.

- [ ] **Step 1: Write the failing test.** Append to `generate.test.ts`:

```ts
import { generateUniformBlocks } from './generate';
import { parse } from '../../../core/parser';

describe('generateUniformBlocks', () => {
	it('produces exactly blockCount paragraphs', () => {
		expect(parse(generateUniformBlocks(50, 4)).children).toHaveLength(50);
	});

	it('is deterministic for the same args', () => {
		expect(generateUniformBlocks(20, 6)).toBe(generateUniformBlocks(20, 6));
	});

	it('content size scales with wordsPerBlock at fixed block count', () => {
		const small = generateUniformBlocks(10, 2);
		const large = generateUniformBlocks(10, 40);
		expect(parse(small).children).toHaveLength(10);
		expect(parse(large).children).toHaveLength(10);
		expect(large.length).toBeGreaterThan(small.length * 5);
	});
});
```

- [ ] **Step 2: Run the test, verify it fails.**

Run: `npm run test:editor:perf -- generate`
Expected: FAIL — `generateUniformBlocks` not exported.

- [ ] **Step 3: Implement in `generate.ts`** (after `generateFixture`, reusing the existing `mulberry32`/`words` helpers):

```ts
/**
 * `blockCount` plain paragraphs of `wordsPerBlock` words each. Varying
 * blockCount at fixed wordsPerBlock isolates mounted-block count; varying
 * wordsPerBlock at fixed blockCount isolates per-block content size.
 */
export function generateUniformBlocks(
	blockCount: number,
	wordsPerBlock: number,
	seed = 42
): string {
	const rand = mulberry32(seed);
	const out: string[] = [];
	for (let i = 0; i < blockCount; i++) out.push(words(rand, wordsPerBlock));
	return out.join('\n\n') + '\n';
}
```

- [ ] **Step 4: Run the test, verify it passes.**

Run: `npm run test:editor:perf -- generate`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/editor/test/perf/fixtures/generate.ts src/lib/editor/test/perf/fixtures/generate.test.ts
git commit -m "+ (perf) uniform-block fixture generator for the block-count/content sweeps"
```

---

## Task 4: Production-mode perf project (the step-zero harness)

**Files:**

- Modify: `playwright.config.ts`
- Modify: `package.json`

The existing `e2e-perf` project runs against the dev server. Step zero needs the _same_ timing methodology against a **production build** (`vite build` + `vite preview`), where `import.meta.env.DEV` is false (asserts tree-shaken, Svelte dev-mode checks gone, code minified). Gate it behind `PERF_PROD` so the slow build only runs when explicitly measuring.

- [ ] **Step 1: Edit `playwright.config.ts`.** Make `webServer` and the prod project conditional on `PERF_PROD`:

```ts
import { defineConfig } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> };
const PROD = !!process.env.PERF_PROD;

const devServer = {
	command: 'npm run dev',
	port: 1420,
	reuseExistingServer: true,
	timeout: 15_000
};

const prodServer = {
	command: 'npm run build && npm run preview -- --port 1421 --strictPort',
	port: 1421,
	reuseExistingServer: true,
	timeout: 180_000
};

export default defineConfig({
	testDir: './src/lib/editor/e2e/tests',
	timeout: 30_000,
	retries: 0,
	use: {
		baseURL: 'http://localhost:1420',
		headless: true,
		permissions: ['clipboard-read', 'clipboard-write']
	},
	webServer: PROD ? [devServer, prodServer] : devServer,
	projects: [
		// …existing projects unchanged…
		...(PROD
			? [
					{
						name: 'e2e-perf-prod',
						testMatch: 'perf/**/*.perf.spec.ts',
						timeout: 600_000,
						use: { viewport: { width: 1280, height: 900 }, baseURL: 'http://localhost:1421' }
					}
				]
			: [])
	]
});
```

Keep every existing project entry; only add the conditional `e2e-perf-prod` to the `projects` array and swap the `webServer` line.

- [ ] **Step 2: Add the `package.json` script** (in `scripts`, after `perf:e2e`):

```json
		"perf:e2e:prod": "playwright test --project=e2e-perf-prod",
```

- [ ] **Step 3: Verify the prod route serves.** SPA fallback (`fallback: 'index.html'`) should serve `/test/editor` client-side.

Run: `npm run build && npm run preview -- --port 1421 --strictPort` (in one shell), then in another: `curl -s -o /dev/null -w "%{http_code}" http://localhost:1421/test/editor`
Expected: `200`. Stop the preview server after. If the route 404s, the SPA fallback isn't applied — fix `svelte.config.js` adapter `fallback` before proceeding (it is currently `'index.html'`, which should work).

- [ ] **Step 4: Commit.**

```bash
git add playwright.config.ts package.json
git commit -m "+ (perf) prod-mode e2e perf project (build+preview) for prod-vs-dev attribution"
```

---

## Task 5: Step-zero measurement — prod vs dev (DECISION GATE)

**This is a measurement protocol, run serially by the owning session. It gates Task 6.**

**Files:**

- Create: `docs/perf/latency-attribution-findings.md`

- [ ] **Step 1: Capture the DEV baseline** for the shapes that settle a keystroke (nested-containers 1MB; flat-prose 1MB as a fast control):

Run: `PERF=1 npm run perf:e2e -- -g "nested-containers 1MB|flat-prose 1MB"`
Record from the `PERF {…}` console lines / `perf-results/e2e-*.json`: `keystrokeP50Ms`, `keystrokeP95Ms`, `loadMs` for each.

- [ ] **Step 2: Capture the PROD numbers** with the identical methodology:

Run: `PERF=1 PERF_PROD=1 npm run perf:e2e:prod -- -g "nested-containers 1MB|flat-prose 1MB"`
Record the same fields. (First run pays the `vite build`; budget for it.)

- [ ] **Step 3: Create the findings doc** `docs/perf/latency-attribution-findings.md`:

```markdown
# 0.8 Latency Attribution — Findings

Machine: <CPU, Node version, OS>. Raw artifacts: `perf-results/` (gitignored). Each axis carries its confirm/falsify result. Spec: `docs/perf/latency-attribution-spec.md`.

## Step zero — prod vs dev (nested-containers 1MB)

| Build | keystroke p50 | keystroke p95 |
| ----- | ------------- | ------------- |
| dev   | <n> ms        | <n> ms        |
| prod  | <n> ms        | <n> ms        |

Prod/dev delta: <n>ms (<pct>%). Dev-only costs removed in prod: assertInvariant tree-shake, Svelte dev-mode checks, minification.

**Decision gate:** <prod still > frame budget → proceed to Axis fan-out (Task 6)> | <prod ≈ frame budget → reframe: the dev number was largely artifact; only the unconditional render wall (0.8.6) survives — record and skip to Task 7 synthesis>.
```

Fill the table and the decision line from Steps 1–2.

- [ ] **Step 4: Apply the gate.**
  - If prod p50 is still well above frame budget (e.g. > ~100ms) → the editor cost is real; **proceed to Task 6**.
  - If prod p50 collapses toward frame budget → most of the 896ms was dev artifact. Record this prominently, note that only the unconditional render wall (0.8.6) remains load-bearing, and **skip Task 6**, going straight to Task 7 synthesis with this conclusion.

- [ ] **Step 5: Commit.**

```bash
git add docs/perf/latency-attribution-findings.md
git commit -m "@ (perf) step-zero prod-vs-dev keystroke attribution"
```

---

## Task 6: Attribution diagnostic spec (Axes 1, 3, 4, 5)

**Run only if Task 5's gate said "proceed."** Code task: write the diagnostic spec (reviewable, reproducible), then run it serially and record results.

**Files:**

- Modify: `src/lib/editor/e2e/tests/perf/attribution.perf.spec.ts`
- Create: `src/lib/editor/e2e/requirements/perf/attribution.md`
- Modify: `docs/perf/latency-attribution-findings.md`

- [ ] **Step 1: Write the requirement file** `src/lib/editor/e2e/requirements/perf/attribution.md`:

```markdown
# Feature: Latency attribution diagnostic

## Captures

- bridge sanity: a keystroke records ≥1 block render and ≥1 in-page sample.
- axis1 fan-out: renders-per-keystroke vs mounted block count (100/1000/5000). Flat ≈ no redundant re-render; scales → redundant (1a).
- axis3 cdp split: ScriptDuration vs LayoutDuration vs RecalcStyleDuration across N keystrokes at fixed large block count.
- axis4 harness overhead: outer (harness) keystroke time vs in-page settle time; delta = polling/IPC.
- axis5 intra-block: keystroke p50 vs single-paragraph length (50KB/200KB/800KB).

## Notes

- All rows run serially (timing-sensitive). Dev server, DEV asserts active — upper bound on production.
```

- [ ] **Step 2: Append the axis captures** to `attribution.perf.spec.ts`. First replace the import header so the helpers' deps resolve:

```ts
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { EditorPage } from '../../editor-page';
import { generateUniformBlocks, generateFixture } from '../../../test/perf/fixtures/generate';
```

Then add the shared helpers and the four tests below the existing bridge-sanity test:

```ts
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

function mean(xs: number[]): number {
	return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
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

async function loadAndFocusLast(page: Page, editor: EditorPage, src: string): Promise<number> {
	await editor.goto();
	await page.evaluate((c) => (window as any).__test.setSource(c), src);
	await settle(page, src.replace(/\s+$/, '').length);
	await editor.waitForRenderFlush();
	const last = await page.evaluate(() => (window as any).__test.getDocument().children.length - 1);
	await editor.focusBlockEnd(last);
	return last;
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
```

- [ ] **Step 3: Lint + typecheck the new spec.**

Run: `npm run check`
Expected: 0 errors / 11 warnings (baseline unchanged).

- [ ] **Step 4: Run the diagnostic serially.** No other heavy process running (timing-sensitive).

Run: `PERF=1 npx playwright test --project=e2e-perf attribution.perf --workers=1`
Expected: all 5 tests PASS; `ATTR …` lines in stdout and `perf-results/attr-*.json` written.

- [ ] **Step 5: Record into the findings doc.** Add an "Axis attribution" section to `docs/perf/latency-attribution-findings.md` with one subsection per axis, each holding the captured numbers and a confirm/falsify line:
  - **Axis 1:** is `blockRenderCount` ≈ 1 across all block counts (→ no redundant re-render, _not_ 1a) or does it scale with `blockCount` (→ redundant, **1a**, cheap fix)? If renders stay ~1 but Axis 5/3 don't explain the latency and it still grows with block count → **1b** (needs VR).
  - **Axis 3:** which of scriptMs / layoutMs / recalcStyleMs dominates the per-keystroke total?
  - **Axis 4:** `harnessP50 − inPageP50` = polling/IPC overhead; record how much of the headline number it accounts for.
  - **Axis 5:** does `p50Ms` scale with paragraph `bytes` at block count 1?

- [ ] **Step 6: Commit.**

```bash
git add src/lib/editor/e2e/tests/perf/attribution.perf.spec.ts src/lib/editor/e2e/requirements/perf/attribution.md docs/perf/latency-attribution-findings.md
git commit -m "+ (perf) attribution diagnostic spec + axis captures"
```

---

## Task 7: Synthesis, adversarial refute, ratified decision

**Measurement/decision protocol. Closes the batch.**

**Files:**

- Modify: `docs/perf/latency-attribution-findings.md`
- Modify: `docs/roadmap.md` (record the ratified decision into 0.8's first-measurement item)

- [ ] **Step 1: Synthesize the split.** In the findings doc, add a "Synthesis" section: the ~896ms attributed across the named axes (subtract Axis 4 harness overhead first; let the Axis 3 CDP split arbitrate scripting-vs-layout). State the **dominant** axis and the ordered remainder by share. Confirm the split accounts for the large majority of the headline number — if a big residual remains, the diagnosis has not succeeded; loop back and add a capture for the unexplained portion.

- [ ] **Step 2: Adversarial refute.** Attack the dominant-axis claim. Concretely: if Axis 1 is named dominant, confirm Task 5's prod number did not already erase it (i.e. it isn't Axis 2 in disguise); if Axis 3 layout is dominant, confirm it isn't an artifact of the 16ms settle poll (Axis 4). Record the refutation attempt and its outcome. (May be dispatched to a fresh reviewer subagent that re-reads the recorded numbers — analysis of captured data, not a new timing run.)

- [ ] **Step 3: Map to the next batch** using the spec's decision tree (`docs/perf/latency-attribution-spec.md` § Decision tree). Write the ratified decision into the findings doc: one named spine (e.g. "0.8.6 virtual rendering" / "finer-grained reactivity patch" / "sub-block levers" / "lazy inlineContent") + the ordered supporting list, and the lazy-raw ladder disposition (arm rung 1 / retire / defer).

- [ ] **Step 4: Record into the roadmap.** Update `docs/roadmap.md` § 0.8's first-measurement item: replace the open "diagnose before optimizing" framing with the ratified outcome and the selected next spine. Keep the roadmap forward-looking (the _decision_, not the measurement narrative — that lives in the findings doc).

- [ ] **Step 5: Full commit gate** (behavior preservation — this batch added measurement, not behavior).

Run: `npm test`
Expected: PASS — full unit + every e2e project incl. the simulation, byte-for-byte unchanged.

Run: `npm run check`
Expected: 0 errors / 11 warnings.

Run: `npm run lint`
Expected: clean (run `npm run format` first if it flags the new docs/specs).

- [ ] **Step 6: Commit.**

```bash
git add docs/perf/latency-attribution-findings.md docs/roadmap.md
git commit -m "@ (perf) ratified 0.8 next-batch decision from the latency attribution"
```

---

## Self-Review Checklist (run before declaring the plan done)

- **Spec coverage:** step-zero prod measurement (Task 5) ✓; capture-serial / analysis-wide (Tasks 5–7 run serially, code in 1–4/6) ✓; Axis 2 decomposed into asserts/Svelte-dev/minify (Task 5 findings) ✓; Axis 1a/1b split (Task 6 Step 5) ✓; instrumentation seam (Tasks 1–2) ✓; fixture sweeps (Task 3) ✓; attribution report + ratified decision (Tasks 6–7) ✓; verification via byte-identical e2e+simulation (Task 7) ✓.
- **Perf-gate CI** is intentionally absent — it is the parked companion spec (`perf-gate-ci-spec.md`), not this batch.
- **Type consistency:** `recordBlockRender`, `markKeystrokeStart`, `markKeystrokeSettle`, `generateUniformBlocks`, `perfEnabled` used identically across tasks.
