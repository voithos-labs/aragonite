import { test, expect } from '../../fixtures';
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
	measureContainerInteriorTyping,
	measureDeepNestedTyping,
	measureTypingIntoDocument,
	measureTypingLatency,
	writePerfResult
} from './latency-harness';

declare const process: { env: Record<string, string | undefined> };

// The `perf:check` gate skips these: they gate nothing, so it should not pay their
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

// Rows above a shape's cap are not generated; omissions are recorded in the requirements
// file. Empty because windowing and lazy inline content removed every former blocker.
const MAX_BYTES: Partial<Record<FixtureShape, number>> = {};

function round(ms: number): number {
	return Math.round(ms * 10) / 10;
}

function writeResult(shape: string, sizeLabel: string, result: object): void {
	writePerfResult('PERF', `e2e-${shape}-${sizeLabel}`, result);
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

// ── Container-interior typing (report companion to the gated rows) ──────────

// The caret INSIDE a giant container — the axis the prose-target rows above cannot reach,
// since they prepend a paragraph precisely to give the caret a top-level home. The first
// child is the one windowing guarantees mounted. Gated twins live in perf-gate.
const CONTAINER_INTERIOR_SHAPES: Array<[shape: FixtureShape, leafPath: number[]]> = [
	['giant-single-list', [0, 0, 0]],
	['giant-single-blockquote', [0, 0]]
];

test.describe('typing latency — container interior', () => {
	for (const [shape, leafPath] of CONTAINER_INTERIOR_SHAPES) {
		test(`${shape} interior 1MB`, async ({ page }) => {
			const editor = new EditorPage(page);
			const m = await measureContainerInteriorTyping(page, editor, shape, leafPath, 1_000_000, 30);
			writeResult(`${shape}-interior`, '1MB', {
				shape,
				leafPath,
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

// Depth 8 × 50KB/level is the realistic worst corner the vitest bench sweeps; the keystroke
// there pays the full ancestry rebuild the top-level rows skip.
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

// The standing ceilings measure an EMPTY inline registry, so no other row sees what a
// registered rung costs. An UNRESERVED trigger (`:`, `$`) flips `needsScan`'s per-character
// probe on document-wide, making plain prose more expensive — the blind spot these rows fill.
//
// CONFOUND: `/test/plugins` installs eight base plugins, two deriving over the whole
// document, so a route delta bounds the rung's cost from ABOVE and is not attributable to
// the rung alone. Do not read "the bail probe costs X" off one.
const RUNG_KEYSTROKES = 30;

interface RungRow {
	row: string;
	// The trigger-dense fixture, or the plain-prose shape for the bail-probe row.
	fixture: TriggerDenseKind | 'flat-prose';
	// `?seed=` on the plugins route; latex rides the base set, so its row needs none.
	seed?: string;
	// A widget the rung mints on the loaded document, proving the rung is live.
	requireWidget?: string;
	// Loaded before the fixture when the fixture itself mints no widget — the only liveness
	// evidence the plain-prose row can carry.
	probeDocument?: { source: string; widget: string };
	// One size unless a row's cost is suspected to scale with the document.
	sizes: Array<[label: string, bytes: number]>;
}

const ONE_SIZE: Array<[string, number]> = [['100KB', 100_000]];

const RUNG_ROWS: RungRow[] = [
	{
		// Two mechanisms in one fixture: the `[^` prefix consultation, and the mounted
		// reference's number re-deriving over the whole document (the third non-viewport
		// axis in docs/design/performance.md). The only row with a size axis, because the
		// consultation is range-bounded while the derivation is not — a 10× document at the
		// same viewport separates them without a second fixture.
		row: 'bracket-dense-footnotes',
		fixture: 'bracket-footnote',
		seed: 'footnotes',
		requireWidget: 'sup.footnote-ref',
		sizes: [
			['100KB', 100_000],
			['1MB', 1_000_000]
		]
	},
	{
		row: 'colon-dense-emoji',
		fixture: 'colon',
		seed: 'emoji',
		requireWidget: '.md-emoji-widget',
		sizes: ONE_SIZE
	},
	{
		row: 'dollar-dense-latex',
		fixture: 'dollar',
		requireWidget: '.math-inline-widget',
		sizes: ONE_SIZE
	},
	{
		// Prose with no trigger at all: `:` is held out of SPECIAL_CHARS, so registering
		// emoji turns on a per-character map lookup before the fast bail decides.
		row: 'plain-prose-bail-emoji',
		fixture: 'flat-prose',
		seed: 'emoji',
		probeDocument: { source: 'probe :tada: line\n', widget: '.md-emoji-widget' },
		sizes: ONE_SIZE
	}
];

function rungFixture(fixture: RungRow['fixture'], bytes: number): string {
	return fixture === 'flat-prose'
		? generateFixture('flat-prose', bytes)
		: generateTriggerDense(fixture, bytes);
}

test.describe('typing latency — installed inline rungs', () => {
	for (const { row, fixture, seed, requireWidget, probeDocument, sizes } of RUNG_ROWS) {
		for (const [sizeLabel, bytes] of sizes) {
			test(`${row} ${sizeLabel}`, async ({ page }) => {
				const document = rungFixture(fixture, bytes);

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

				writeResult(`rung-${row}`, sizeLabel, {
					row,
					fixture,
					seed: seed ?? '(base plugins only)',
					bytes,
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
	// The inline recompute rides the debounced input flush (~250ms after the keystroke),
	// so the source settle above lands well before it.
	await page.waitForFunction(
		() => (window as any).__test.perf.snapshot().inlineComputeCount >= 1,
		null,
		{ timeout: 5_000, polling: 16 }
	);
	const snapshot = await page.evaluate(() => (window as any).__test.perf.snapshot());
	expect(snapshot.inlineComputeCount).toBeGreaterThanOrEqual(1);
});
