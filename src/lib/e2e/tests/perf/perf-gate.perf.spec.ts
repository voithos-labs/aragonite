import { test, expect } from '../../fixtures';
import { readFileSync } from 'node:fs';
import { EditorPage } from '../../editor-page';
import { type FixtureShape } from '../../../test/perf/fixtures/generate';
import { measureContainerHeadTyping, measureTypingLatency } from './latency-harness';

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

test.describe('perf gate — keystroke p50 within budget', () => {
	for (const [shape, size, mode] of GATED_ROWS) {
		const key = mode ? `${shape}-${size}-${mode}` : `${shape}-${size}`;
		test(key.replace(/-/g, ' '), async ({ page }) => {
			const row = baseline.e2e[key];
			const ceiling = (row.keystrokeP50Ms * TOLERANCE + FLOOR_MS) * RUNNER_SCALE;

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
					`ceiling=${ceiling.toFixed(1)}ms (baseline ${row.keystrokeP50Ms}ms) ` +
					`p95=${m.p95Ms.toFixed(1)}ms load=${m.loadMs.toFixed(1)}ms`
			);
			expect(m.p50Ms, `${key} p50 regressed past baseline+budget`).toBeLessThanOrEqual(ceiling);
		});
	}
});

// Typing INSIDE a container, not ahead of one: every row above prepends a paragraph, so no
// other gated caret ever sits inside one. A keystroke on the head child rewrites the
// container's opener line, and an ungated re-derivation would parse the whole container.
const CONTAINER_HEAD_ROWS: Array<[shape: FixtureShape, headLeafPath: number[], size: string]> = [
	['giant-single-list', [0, 0, 0], '1MB'],
	['giant-single-blockquote', [0, 0], '1MB']
];

test.describe('perf gate — keystroke p50 typing into a container head', () => {
	for (const [shape, headLeafPath, size] of CONTAINER_HEAD_ROWS) {
		test(`${shape} head ${size}`, async ({ page }) => {
			const row = baseline.e2e[`${shape}-head-${size}`];
			const ceiling = (row.keystrokeP50Ms * TOLERANCE + FLOOR_MS) * RUNNER_SCALE;

			const editor = new EditorPage(page);
			const m = await measureContainerHeadTyping(
				page,
				editor,
				shape,
				headLeafPath,
				SIZE_BYTES[size],
				SIZE_KEYSTROKES[size]
			);

			console.log(
				`PERF-GATE ${shape}-head-${size} p50=${m.p50Ms.toFixed(1)}ms ` +
					`ceiling=${ceiling.toFixed(1)}ms (baseline ${row.keystrokeP50Ms}ms) p95=${m.p95Ms.toFixed(1)}ms`
			);
			expect(
				m.p50Ms,
				`${shape}-head-${size} p50 regressed past baseline+budget`
			).toBeLessThanOrEqual(ceiling);
		});
	}
});
