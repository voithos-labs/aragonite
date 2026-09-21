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

// The `perf:check` gate skips these: they gate nothing, so it should not pay their runtime or
// their risk of flaking.
test.skip(
	!process.env.PERF || !!process.env.PERF_GATE,
	'report-only — run via `npm run perf:e2e`; the perf:check gate skips these'
);

// Every row runs against the dev server with the dev-mode checks on, so each number is a
// cautious upper bound on the latency in production.
const DEV_CAVEAT = 'dev server, DEV invariant assertions active — conservative upper bound';

const SIZES: Array<[label: string, bytes: number, keystrokes: number]> = [
	['100KB', 100_000, 30],
	['1MB', 1_000_000, 30],
	// Fewer keystrokes at 10MB: each one costs with both the block and the document there, and
	// 15 samples already give a steady p50 and p95 at latencies of about a second.
	['10MB', 10_000_000, 15]
];

// Rows past a shape's limit are not generated, and anything left out is recorded in the
// requirements file. Empty, because windowing and lazy inline content removed every blocker.
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

// The caret inside a huge container, which the rows above cannot reach, since they put a
// paragraph in front precisely to give the caret a top-level home. The first child is the one
// windowing always keeps mounted. The gated versions of these rows live in perf-gate.
const CONTAINER_INTERIOR_SHAPES: Array<[shape: FixtureShape, leafPath: number[]]> = [
	['giant-single-list', [0, 0, 0]],
	['giant-single-blockquote', [0, 0]]
];

test.describe('typing latency: container interior', () => {
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

// Eight levels deep at 50KB each is the realistic worst case the vitest benchmark covers; a
// keystroke there pays for rebuilding every block above it, which the top-level rows skip.
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

// ── Installed inline handlers (report only) ─────────────────────────────────

// The standing ceilings measure an empty inline registry, so no other row shows what a
// registered handler costs. A trigger character the scanner does not reserve (`:`, `$`) turns
// on a per-character check across the whole document, which these rows measure.
//
// Careful: `/test/plugins` installs eight base plugins, two working over the whole document, so
// a difference between routes is an upper bound rather than the handler's own cost.
const RUNG_KEYSTROKES = 30;

interface RungRow {
	row: string;
	// The fixture full of trigger characters, or plain prose for the quick-exit row.
	fixture: TriggerDenseKind | 'flat-prose';
	// `?seed=` on the plugins route; latex is in the base set, so its row needs none.
	seed?: string;
	// A widget the handler creates on the loaded document, which proves it is running.
	requireWidget?: string;
	// Loaded before the fixture when the fixture itself produces no widget: the only evidence
	// the plain-prose row can carry that the handler is running.
	probeDocument?: { source: string; widget: string };
	// One size, unless a row's cost is thought to grow with the document.
	sizes: Array<[label: string, bytes: number]>;
}

const ONE_SIZE: Array<[string, number]> = [['100KB', 100_000]];

const RUNG_ROWS: RungRow[] = [
	{
		// Two costs in one fixture: looking up the `[^` prefix, and working out a mounted
		// reference's number over the whole document, which is the third cost that does not
		// scale with the viewport (docs/design/performance.md). The only row that varies the
		// document size, because the lookup is bounded and the numbering is not, so a document
		// ten times larger at the same viewport separates them without a second fixture.
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
		// Prose with no trigger character at all: `:` is kept out of SPECIAL_CHARS, so
		// registering emoji turns on a map lookup for every character before the quick exit.
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

test.describe('typing latency: installed inline syntax handlers', () => {
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
						`the inline syntax handler is not live on this route: ${probeDocument.widget} never mounted`
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
					note: `${DEV_CAVEAT}; report-only, and the plugins route installs eight base plugins, so the delta bounds the inline syntax handler's cost from above`
				});
				expect(rung.samples).toHaveLength(RUNG_KEYSTROKES);
				expect(rungFree.samples).toHaveLength(RUNG_KEYSTROKES);
			});
		}
	}
});

// ── Bridge sanity ───────────────────────────────────────────────────────────

test('perf bridge: a keystroke drives the inline-refresh sweep', async ({ page }) => {
	// The bridge's counters run only in dev, so the production route has nothing to read.
	test.skip(!!process.env.PERF_PROD, 'dev-only instruments');
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
	// The inline recompute happens on the debounced input flush, about 250ms after the
	// keystroke, so the wait on the source above returns well before it.
	await page.waitForFunction(
		() => (window as any).__test.perf.snapshot().inlineComputeCount >= 1,
		null,
		{ timeout: 5_000, polling: 16 }
	);
	const snapshot = await page.evaluate(() => (window as any).__test.perf.snapshot());
	expect(snapshot.inlineComputeCount).toBeGreaterThanOrEqual(1);
});
