import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { EditorPage } from '../../editor-page';
import {
	FIXTURE_SHAPES,
	generateFixture,
	type FixtureShape
} from '../../../test/perf/fixtures/generate';

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
//   reference-heavy @10MB — loads, but one keystroke fails to settle in 60s
//   (per-edit whole-doc inline sweep over ~65k reference blocks; the dirty-set
//   scoping item targets exactly this).
const MAX_BYTES: Partial<Record<FixtureShape, number>> = {
	'many-small-blocks': 1_000_000,
	'nested-containers': 1_000_000,
	'reference-heavy': 1_000_000,
	'table-heavy': 1_000_000
};

// Shapes whose first block is a container (list, table): focusBlockEnd(0)
// cannot place a caret inside those, and table-cell edits re-pad the whole
// table (breaking the +1-length settle). These rows type into an appended
// plain paragraph instead — the dominant per-keystroke cost (the whole-doc
// inline sweep) is caret-position-independent, and ancestry-rebuild cost is
// covered directly by the vitest bench.
const NEEDS_PROSE_TARGET: ReadonlySet<FixtureShape> = new Set(['nested-containers', 'table-heavy']);
const PROSE_TARGET = 'perf cursor target\n';

const LOAD_TIMEOUT_MS = 480_000;
const KEYSTROKE_TIMEOUT_MS = 60_000;

// ── Settle predicate ────────────────────────────────────────────────────────

// O(top-level children) CST length probe. getSource() serializes the whole
// doc per poll, which at 10MB would dwarf the latency being measured; summing
// raw lengths observes the same commit without building the string.
function docLengthInPage(): number {
	const doc = (window as any).__test.getDocument();
	let length = doc.prefix.length + doc.suffix.length;
	for (const child of doc.children) length += child.leadingTrivia.length + child.raw.length;
	return length;
}

async function waitForDocLength(page: Page, min: number, timeout: number): Promise<void> {
	await page.waitForFunction(
		({ fnSrc, min }) => (new Function(`return (${fnSrc})();`)() as number) >= min,
		{ fnSrc: docLengthInPage.toString(), min },
		{ timeout, polling: 16 }
	);
}

// ── Reporting ───────────────────────────────────────────────────────────────

function percentileMs(samples: number[], p: number): number {
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

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
				await editor.goto();
				const needsTarget = NEEDS_PROSE_TARGET.has(shape);
				const fixture = generateFixture(shape, bytes) + (needsTarget ? '\n' + PROSE_TARGET : '');

				const loadStart = performance.now();
				await page.evaluate((content) => (window as any).__test.setSource(content), fixture);
				// serialize() may trim trailing whitespace, so settle on the
				// trimmed length; the pre-load doc is orders of magnitude smaller.
				await waitForDocLength(page, fixture.replace(/\s+$/, '').length, LOAD_TIMEOUT_MS);
				await editor.waitForRenderFlush();
				const loadMs = performance.now() - loadStart;

				// CST index, not getDomBlockCount(): the chained block locator
				// evaluates per top-level host and takes minutes at thousands of
				// hosts; the appended target is by construction the last child.
				const targetBlock = needsTarget
					? await page.evaluate(() => (window as any).__test.getDocument().children.length - 1)
					: 0;
				await editor.focusBlockEnd(targetBlock);
				const baseLength = await page.evaluate(docLengthInPage);
				const samples: number[] = [];
				for (let i = 1; i <= keystrokes; i++) {
					const keyStart = performance.now();
					await editor.typeSlowly('x');
					await waitForDocLength(page, baseLength + i, KEYSTROKE_TIMEOUT_MS);
					samples.push(performance.now() - keyStart);
				}

				writeResult(shape, sizeLabel, {
					shape,
					bytes,
					loadMs: round(loadMs),
					keystrokes,
					keystrokeP50Ms: round(percentileMs(samples, 50)),
					keystrokeP95Ms: round(percentileMs(samples, 95)),
					note: DEV_CAVEAT
				});
				expect(samples).toHaveLength(keystrokes);
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
