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
// never to silence a real regression. 10MB rows wait on virtual rendering
// (0.8.6); only the renderable ≤1MB shapes are gated here.
const TOLERANCE = 1.1;
const FLOOR_MS = 5;
const BYTES = 1_000_000;
const KEYSTROKES = 30;

const GATED_SHAPES: FixtureShape[] = [
	'flat-prose',
	'nested-containers',
	'reference-heavy',
	'table-heavy'
];

interface E2eBaselineRow {
	keystrokeP50Ms: number;
	keystrokeP95Ms: number;
}

const baseline: { e2e: Record<string, E2eBaselineRow> } = JSON.parse(
	readFileSync('src/lib/editor/test/perf/baseline.json', 'utf8')
);

test.describe('perf gate — keystroke p50 within budget (1MB)', () => {
	for (const shape of GATED_SHAPES) {
		test(`${shape} 1MB`, async ({ page }) => {
			const row = baseline.e2e[`${shape}-1MB`];
			const ceiling = row.keystrokeP50Ms * TOLERANCE + FLOOR_MS;

			const editor = new EditorPage(page);
			const m = await measureTypingLatency(page, editor, shape, BYTES, KEYSTROKES);

			console.log(
				`PERF-GATE ${shape}-1MB p50=${m.p50Ms.toFixed(1)}ms ` +
					`ceiling=${ceiling.toFixed(1)}ms (baseline ${row.keystrokeP50Ms}ms) p95=${m.p95Ms.toFixed(1)}ms`
			);
			expect(m.p50Ms, `${shape}-1MB p50 regressed past baseline+budget`).toBeLessThanOrEqual(
				ceiling
			);
		});
	}
});
