import { test, expect } from '../../fixtures';
import { readFileSync } from 'node:fs';
import { EditorPage } from '../../editor-page';
import { type FixtureShape } from '../../../test/perf/fixtures/generate';
import {
	measureContainerInteriorTyping,
	measureStructuralRebuild,
	measureTypingLatency
} from './latency-harness';

declare const process: { env: Record<string, string | undefined> };

// Only the launcher that means to run this turns it on, so a skipped gate can never look green
// as if it had run.
test.skip(!process.env.PERF_GATE, 'run via `npm run perf:check`');

// A regression gate for one machine during development. The p50 varies by about 3 to 4% on the
// same machine, so +10% clears the noise, and the floor keeps cheap rows from failing on a few
// milliseconds of jitter. Gate on the steady p50 and report the p95. Re-measure baseline.json
// only for a toolchain change, with a changelog note, never to quiet a regression. Gating the
// 10MB rows is what keeps a cost per viewport from quietly becoming a cost per document.
const TOLERANCE = 1.1;
const FLOOR_MS = 5;
// A slower machine scales every ceiling rather than re-measuring baselines per host. Locally it
// stays 1, the tight gate; CI sets it, which turns its gate into a net for large regressions.
const RUNNER_SCALE = Number(process.env.PERF_RUNNER_SCALE ?? '1');

const SIZE_BYTES: Record<string, number> = { '1MB': 1_000_000, '10MB': 10_000_000 };
const SIZE_KEYSTROKES: Record<string, number> = { '1MB': 30, '10MB': 15 };

// The mode is a variable, not a second harness: a `live` row measures the same keystroke as the
// source row above it, on a route that starts in that mode. Hiding markers is CSS over the one
// render path, so a live row outside its source row's range means the walk over hidden text
// added work to every keystroke.
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
 * The measured row and the ceiling it sets. A gated row with no baseline fails here and names
 * itself: a row is only as good as a number somebody measured on the reference machine.
 */
function gateFor(key: string): { baselineMs: number; ceilingMs: number } {
	const row = baseline.e2e[key];
	if (!row) {
		throw new Error(`${key}: no row in baseline.json; bless one on the calibration machine`);
	}
	return {
		baselineMs: row.keystrokeP50Ms,
		ceilingMs: (row.keystrokeP50Ms * TOLERANCE + FLOOR_MS) * RUNNER_SCALE
	};
}

test.describe('perf gate: keystroke p50 within budget', () => {
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

// Typing inside a container, not in front of one: every row above puts a paragraph first, so no
// other gated caret ever sits inside. What varies is how many children the container has rather
// than where the caret is, and the first child is the one windowing always keeps mounted. It is
// also the expensive one: the only position whose keystroke moves the container's opening line.
const CONTAINER_INTERIOR_ROWS: Array<[shape: FixtureShape, leafPath: number[], size: string]> = [
	['giant-single-list', [0, 0, 0], '1MB'],
	['giant-single-blockquote', [0, 0], '1MB'],
	['giant-single-list', [0, 0, 0], '10MB']
];

test.describe('perf gate: keystroke p50 typing inside a container', () => {
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

// A split or merge at the top level rebuilds the whole windowing model, which no typed character
// does. On a large flat document that rebuild must stay proportional to the block count.
const STRUCTURAL_ROWS: Array<[shape: FixtureShape, size: string]> = [['flat-prose', '10MB']];
const STRUCTURAL_EDITS = 16;

test.describe('perf gate: structural edit p50 within budget', () => {
	for (const [shape, size] of STRUCTURAL_ROWS) {
		test(`${shape} ${size} structural`, async ({ page }) => {
			const key = `${shape}-${size}-structural`;
			const { baselineMs, ceilingMs } = gateFor(key);

			const editor = new EditorPage(page);
			const m = await measureStructuralRebuild(
				page,
				editor,
				shape,
				SIZE_BYTES[size],
				STRUCTURAL_EDITS
			);

			console.log(
				`PERF-GATE ${key} p50=${m.p50Ms.toFixed(1)}ms ` +
					`ceiling=${ceilingMs.toFixed(1)}ms (baseline ${baselineMs}ms) p95=${m.p95Ms.toFixed(1)}ms`
			);
			expect(m.p50Ms, `${key} p50 regressed past baseline+budget`).toBeLessThanOrEqual(ceilingMs);
		});
	}
});
