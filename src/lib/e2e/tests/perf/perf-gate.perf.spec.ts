import { test, expect } from '@playwright/test';
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
// Rows: the ≤1MB shapes (all renderable), plus the giant-single shapes at 10MB —
// their keystroke is O(viewport) (windowing bounds the mount of one giant
// container), so gating at 10MB is what guards that claim against an O(doc)
// regression that would hide at 1MB. The flat high-block-count 10MB rows
// (flat-prose/many-small/reference-heavy) carry an O(top-level-count) cost that
// is not viewport-bounded; they stay recorded-not-gated to avoid a wall-clock-
// sensitive ceiling.
const TOLERANCE = 1.1;
const FLOOR_MS = 5;

const SIZE_BYTES: Record<string, number> = { '1MB': 1_000_000, '10MB': 10_000_000 };
const SIZE_KEYSTROKES: Record<string, number> = { '1MB': 30, '10MB': 15 };

const GATED_ROWS: Array<[shape: FixtureShape, size: string]> = [
	['flat-prose', '1MB'],
	['nested-containers', '1MB'],
	['reference-heavy', '1MB'],
	['table-heavy', '1MB'],
	['giant-single-list', '10MB'],
	['giant-single-blockquote', '10MB'],
	['giant-single-table', '10MB']
];

interface E2eBaselineRow {
	keystrokeP50Ms: number;
	keystrokeP95Ms: number;
}

const baseline: { e2e: Record<string, E2eBaselineRow> } = JSON.parse(
	readFileSync('src/lib/editor/test/perf/baseline.json', 'utf8')
);

test.describe('perf gate — keystroke p50 within budget', () => {
	for (const [shape, size] of GATED_ROWS) {
		test(`${shape} ${size}`, async ({ page }) => {
			const row = baseline.e2e[`${shape}-${size}`];
			const ceiling = row.keystrokeP50Ms * TOLERANCE + FLOOR_MS;

			const editor = new EditorPage(page);
			const m = await measureTypingLatency(page, editor, shape, SIZE_BYTES[size], SIZE_KEYSTROKES[size]);

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
