import { test, expect } from '../../fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from '../plugins/helpers';
import {
	FIXTURE_SHAPES,
	generateFixture,
	generateTriggerDense,
	type FixtureShape,
	type TriggerDenseKind
} from '../../../test/perf/fixtures/generate';
import {
	measureContainerHeadTyping,
	measureDeepNestedTyping,
	measureTypingIntoDocument,
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

// ── Installed inline rungs (report-only) ────────────────────────────────────

// The standing ceilings measure an EMPTY inline registry: no bundled plugin is
// installed on the editor route, so no row sees what a registered rung costs. Three
// bundled rungs ship on the two shapes — footnotes' reserved `[^` prefix, emoji's
// and latex's unreserved `:`/`$` — and each pays a per-occurrence consultation
// inside ranges `needsScan` admits. The unreserved shape also flips `needsScan`'s
// per-character probe on for the whole document, so PLAIN PROSE gets more expensive
// once any unreserved rung is installed: the row the standing gate is blindest to.
//
// Each row measures the trigger-dense (or plain) fixture twice: once on the plugins
// route where the rung is installed, once on the rung-free editor route, so the
// delta rides in the artifact instead of a claim.
//
// CONFOUND, stated because no route here is a clean control: `/test/plugins` installs
// eight base plugins (callout, details, latex, admonitions, mermaid, memo, doc-stats,
// toc), two of which derive over the whole document. So a route delta bounds the
// installed-rung cost from ABOVE and is not attributable to the rung alone. Report
// the numbers; do not read "the bail probe costs X" off a route delta.
const RUNG_BYTES = 100_000;
const RUNG_KEYSTROKES = 30;

interface RungRow {
	row: string;
	// The trigger-dense fixture, or the plain-prose shape for the bail-probe row.
	fixture: TriggerDenseKind | 'flat-prose';
	// `?seed=` on the plugins route; latex rides the base set, so its row needs none.
	seed?: string;
	// A widget the rung mints on the loaded document, proving the rung is live.
	requireWidget?: string;
	// Loaded before the fixture when the fixture itself mints no widget — the only
	// liveness evidence the plain-prose row can carry.
	probeDocument?: { source: string; widget: string };
}

const RUNG_ROWS: RungRow[] = [
	{
		// Two mechanisms, one fixture: the `[^` prefix consultation on every `[`, and
		// the mounted reference's number, which re-derives from a walk over the whole
		// document on every content version (the third non-viewport axis in
		// docs/design/performance.md). The widget count in the artifact is what says
		// the second mechanism was live.
		row: 'bracket-dense-footnotes',
		fixture: 'bracket-footnote',
		seed: 'footnotes',
		requireWidget: 'sup.footnote-ref'
	},
	{
		row: 'colon-dense-emoji',
		fixture: 'colon',
		seed: 'emoji',
		requireWidget: '.md-emoji-widget'
	},
	{
		row: 'dollar-dense-latex',
		fixture: 'dollar',
		requireWidget: '.math-inline-widget'
	},
	{
		// The bail-probe row: ordinary prose with no trigger in it at all, under an
		// installed unreserved rung. `:` is held out of SPECIAL_CHARS, so registering
		// emoji turns on a per-character map lookup before the fast bail decides.
		row: 'plain-prose-bail-emoji',
		fixture: 'flat-prose',
		seed: 'emoji',
		probeDocument: { source: 'probe :tada: line\n', widget: '.md-emoji-widget' }
	}
];

function rungFixture(fixture: RungRow['fixture']): string {
	return fixture === 'flat-prose'
		? generateFixture('flat-prose', RUNG_BYTES)
		: generateTriggerDense(fixture, RUNG_BYTES);
}

test.describe('typing latency — installed inline rungs', () => {
	for (const { row, fixture, seed, requireWidget, probeDocument } of RUNG_ROWS) {
		test(`${row} 100KB`, async ({ page }) => {
			const document = rungFixture(fixture);

			const plugins = new PluginsPage(page);
			await plugins.gotoPlugins(seed);
			if (probeDocument) {
				await plugins.loadContent(probeDocument.source);
				expect(
					await page.locator(probeDocument.widget).count(),
					`the rung is not live on this route — ${probeDocument.widget} never mounted`
				).toBeGreaterThan(0);
			}
			const rung = await measureTypingIntoDocument(
				page,
				plugins,
				document,
				RUNG_KEYSTROKES,
				requireWidget
			);

			const control = new EditorPage(page);
			await control.goto();
			const rungFree = await measureTypingIntoDocument(page, control, document, RUNG_KEYSTROKES);

			writeResult(`rung-${row}`, '100KB', {
				row,
				fixture,
				seed: seed ?? '(base plugins only)',
				bytes: RUNG_BYTES,
				keystrokes: RUNG_KEYSTROKES,
				mountedWidgets: rung.mountedWidgets ?? 0,
				rungLoadMs: round(rung.loadMs),
				rungP50Ms: round(rung.p50Ms),
				rungP95Ms: round(rung.p95Ms),
				rungFreeLoadMs: round(rungFree.loadMs),
				rungFreeP50Ms: round(rungFree.p50Ms),
				rungFreeP95Ms: round(rungFree.p95Ms),
				note: `${DEV_CAVEAT}; report-only, and the plugins route installs eight base plugins, so the delta bounds the rung's cost from above`
			});
			expect(rung.samples).toHaveLength(RUNG_KEYSTROKES);
			expect(rungFree.samples).toHaveLength(RUNG_KEYSTROKES);
		});
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
