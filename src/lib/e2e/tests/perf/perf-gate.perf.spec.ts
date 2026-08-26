import { test, expect } from '../../fixtures';
import { readFileSync } from 'node:fs';
import { EditorPage } from '../../editor-page';
import { type FixtureShape } from '../../../test/perf/fixtures/generate';
import { measureContainerInteriorTyping, measureTypingLatency } from './latency-harness';

declare const process: { env: Record<string, string | undefined> };

// Only the deliberate launcher arms this, so a skipped gate can never read green as if it
// had run.
test.skip(!process.env.PERF_GATE, 'run via `npm run perf:check`');

// Single-machine dev-time regression gate. Same-machine p50 spread is ~3-4% measured, so
// +10% clears the noise; the floor keeps cheap rows from tripping on a few ms of jitter.
// Gate on the stable p50, report p95. Re-bless baseline.json only for a toolchain bump,
// with a changelog note — never to silence a regression. Gating the 10MB rows is what
// guards the O(viewport) claim against an O(doc) regression that would hide at 1MB.
const TOLERANCE = 1.1;
const FLOOR_MS = 5;
// Slower environments scale the whole ceiling rather than re-blessing baselines per host.
// Local stays 1 (the tight gate); CI sets it, making its gate a gross-regression net.
const RUNNER_SCALE = Number(process.env.PERF_RUNNER_SCALE ?? '1');

const SIZE_BYTES: Record<string, number> = { '1MB': 1_000_000, '10MB': 10_000_000 };
const SIZE_KEYSTROKES: Record<string, number> = { '1MB': 30, '10MB': 15 };

// The mode is a row axis, not a second harness: a `live` row measures the same keystroke the
// source row above it does, on a route that starts in that rung. Marker hiding is CSS over the
// one render path, so a live row landing outside its source twin's band means per-keystroke
// work entered with the hidden-run walk.
const GATED_ROWS: Array<[shape: FixtureShape, size: string, mode?: 'live']> = [
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
	['reference-heavy', '10MB'],
	['flat-prose', '1MB', 'live'],
	['nested-containers', '1MB', 'live']
];

interface E2eBaselineRow {
	keystrokeP50Ms: number;
	keystrokeP95Ms: number;
}

const baseline: { e2e: Record<string, E2eBaselineRow> } = JSON.parse(
	readFileSync('src/lib/test/perf/baseline.json', 'utf8')
);

/**
 * The blessed row and the ceiling it implies. A gated key with no baseline row fails here,
 * naming itself: the row is only as good as a number somebody measured on the pinned host.
 */
function gateFor(key: string): { baselineMs: number; ceilingMs: number } {
	const row = baseline.e2e[key];
	if (!row) {
		throw new Error(`${key}: no row in baseline.json — bless one on the calibration machine`);
	}
	return {
		baselineMs: row.keystrokeP50Ms,
		ceilingMs: (row.keystrokeP50Ms * TOLERANCE + FLOOR_MS) * RUNNER_SCALE
	};
}

test.describe('perf gate — keystroke p50 within budget', () => {
	for (const [shape, size, mode] of GATED_ROWS) {
		const key = mode ? `${shape}-${size}-${mode}` : `${shape}-${size}`;
		test(key.replace(/-/g, ' '), async ({ page }) => {
			const { baselineMs, ceilingMs } = gateFor(key);

			const editor = new EditorPage(page);
			const m = await measureTypingLatency(
				page,
				editor,
				shape,
				SIZE_BYTES[size],
				SIZE_KEYSTROKES[size],
				mode ?? 'source'
			);

			console.log(
				`PERF-GATE ${key} p50=${m.p50Ms.toFixed(1)}ms ` +
					`ceiling=${ceilingMs.toFixed(1)}ms (baseline ${baselineMs}ms) ` +
					`p95=${m.p95Ms.toFixed(1)}ms load=${m.loadMs.toFixed(1)}ms`
			);
			expect(m.p50Ms, `${key} p50 regressed past baseline+budget`).toBeLessThanOrEqual(ceilingMs);
		});
	}
});

// Typing INSIDE a container, not ahead of one: every row above prepends a paragraph, so no
// other gated caret ever sits inside one. The variable is the container's child COUNT rather
// than where the caret sits, and the first child is the one windowing guarantees mounted; it is
// also the expensive end, the only position whose keystroke moves the container's opener line.
const CONTAINER_INTERIOR_ROWS: Array<[shape: FixtureShape, leafPath: number[], size: string]> = [
	['giant-single-list', [0, 0, 0], '1MB'],
	['giant-single-blockquote', [0, 0], '1MB'],
	['giant-single-list', [0, 0, 0], '10MB']
];

test.describe('perf gate — keystroke p50 typing inside a container', () => {
	for (const [shape, leafPath, size] of CONTAINER_INTERIOR_ROWS) {
		test(`${shape} interior ${size}`, async ({ page }) => {
			const key = `${shape}-interior-${size}`;
			const { baselineMs, ceilingMs } = gateFor(key);

			const editor = new EditorPage(page);
			const m = await measureContainerInteriorTyping(
				page,
				editor,
				shape,
				leafPath,
				SIZE_BYTES[size],
				SIZE_KEYSTROKES[size]
			);

			console.log(
				`PERF-GATE ${key} p50=${m.p50Ms.toFixed(1)}ms ` +
					`ceiling=${ceilingMs.toFixed(1)}ms (baseline ${baselineMs}ms) p95=${m.p95Ms.toFixed(1)}ms`
			);
			expect(m.p50Ms, `${key} p50 regressed past baseline+budget`).toBeLessThanOrEqual(ceilingMs);
		});
	}
});
