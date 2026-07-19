import { test, expect } from '../../fixtures';
import { readFileSync } from 'node:fs';
import { EditorPage } from '../../editor-page';
import { type FixtureShape } from '../../../test/perf/fixtures/generate';
import { measureTypingLatency } from './latency-harness';

declare const process: { env: Record<string, string | undefined> };

// Runs only when invoked deliberately (`npm run perf:check` sets PERF_GATE), so
// the slow timing rows never join the fast `npm test`. Skips loudly, not
// silently — a skipped gate that reads green would be theater, so the launcher
// is the only path that arms it.
test.skip(!process.env.PERF_GATE, 'run via `npm run perf:check`');

// Single-machine dev-time regression gate. Same-machine run-to-run spread on
// the p50 is ~3-4% (measured), so a +10% budget clears the noise while catching
// real slowdowns; the +5ms floor keeps cheap rows from tripping on a few ms of
// jitter. Gate on the stable p50, report p95. Update baseline.json deliberately
// (with a changelog note) after a Chromium/OS/toolchain bump moves the floor —
// never to silence a real regression.
//
// Rows: the ≤1MB shapes plus every renderable shape's 10MB keystroke — all
// O(viewport). Windowing bounds the mounted set to the viewport regardless of
// block count (attribution axisS: mounted/renders flat 1k→30k), so gating at 10MB
// guards the O(viewport) claim against an O(doc) regression that would hide at
// 1MB. The flat high-block-count shapes (flat-prose/many-small-blocks/reference-
// heavy) were previously excluded on a belief they carried an O(top-level-count)
// keystroke cost; that was a harness artifact — the per-keystroke settle summed
// docLengthInPage over the whole $state-proxy children array — now fixed in
// latency-harness, so they gate too. (Intra-block single-giant-paragraph stays
// recorded-not-gated: its span rebuild is O(paragraph length), not viewport-
// bounded — a genuinely separate axis.)
const TOLERANCE = 1.1;
const FLOOR_MS = 5;
// Baselines were measured on the calibration machine; slower environments (CI
// runners measured ~2.2x) scale the whole ceiling rather than re-blessing
// baselines per host. Local stays 1 — the tight gate; CI sets it in the
// workflow env, making the CI gate a gross-regression net, not a re-tuned one.
const RUNNER_SCALE = Number(process.env.PERF_RUNNER_SCALE ?? '1');

const SIZE_BYTES: Record<string, number> = { '1MB': 1_000_000, '10MB': 10_000_000 };
const SIZE_KEYSTROKES: Record<string, number> = { '1MB': 30, '10MB': 15 };

const GATED_ROWS: Array<[shape: FixtureShape, size: string]> = [
	['flat-prose', '1MB'],
	['nested-containers', '1MB'],
	['reference-heavy', '1MB'],
	['table-heavy', '1MB'],
	['many-small-blocks', '1MB'],
	['giant-single-list', '10MB'],
	['giant-single-blockquote', '10MB'],
	['giant-single-table', '10MB'],
	['flat-prose', '10MB'],
	['many-small-blocks', '10MB'],
	['reference-heavy', '10MB']
];

interface E2eBaselineRow {
	keystrokeP50Ms: number;
	keystrokeP95Ms: number;
}

const baseline: { e2e: Record<string, E2eBaselineRow> } = JSON.parse(
	readFileSync('src/lib/test/perf/baseline.json', 'utf8')
);

test.describe('perf gate — keystroke p50 within budget', () => {
	for (const [shape, size] of GATED_ROWS) {
		test(`${shape} ${size}`, async ({ page }) => {
			const row = baseline.e2e[`${shape}-${size}`];
			const ceiling = (row.keystrokeP50Ms * TOLERANCE + FLOOR_MS) * RUNNER_SCALE;

			const editor = new EditorPage(page);
			const m = await measureTypingLatency(
				page,
				editor,
				shape,
				SIZE_BYTES[size],
				SIZE_KEYSTROKES[size]
			);

			console.log(
				`PERF-GATE ${shape}-${size} p50=${m.p50Ms.toFixed(1)}ms ` +
					`ceiling=${ceiling.toFixed(1)}ms (baseline ${row.keystrokeP50Ms}ms) p95=${m.p95Ms.toFixed(1)}ms`
			);
			expect(m.p50Ms, `${shape}-${size} p50 regressed past baseline+budget`).toBeLessThanOrEqual(
				ceiling
			);
		});
	}
});
