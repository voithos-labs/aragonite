import { test, expect } from '../../fixtures';
import { readFileSync } from 'node:fs';
import { EditorPage } from '../../editor-page';
import { type FixtureShape } from '../../../test/perf/fixtures/generate';
import {
	measureContainerEdit,
	measureContainerInteriorTyping,
	measureContainerRangeRemoval,
	measureFirstCopy,
	measureListCopy,
	measureNewParagraphLetter,
	measureRangeRemoval,
	measureStructuralRebuild,
	measureTypingLatency,
	measureTypingWithPositionReads,
	type GiantContainer
} from './latency-harness';

declare const process: { env: Record<string, string | undefined> };

// Only the launcher that means to run this turns it on, so a skipped gate can never look green
// as if it had run.
test.skip(!process.env.PERF_GATE, 'run via `npm run perf:check`');

// The p50 varies about 3 to 4% on one machine, so +10% clears the noise and the floor absorbs
// jitter on cheap rows. Re-measure baseline.json only for a toolchain change, never to quiet a red.
const TOLERANCE = 1.1;
const FLOOR_MS = 5;
// A slower machine scales every ceiling rather than re-measuring baselines per host. Locally it
// stays 1, the tight gate; CI sets it, which turns its gate into a net for large regressions.
const RUNNER_SCALE = Number(process.env.PERF_RUNNER_SCALE ?? '1');

const SIZE_BYTES: Record<string, number> = { '1MB': 1_000_000, '10MB': 10_000_000 };
const SIZE_KEYSTROKES: Record<string, number> = { '1MB': 30, '10MB': 15 };

// A `live` row measures the same keystroke as the source row above it; hiding markers is CSS over
// one render path, so a live row out of its source row's range means hidden text added work.
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

// A plugin that follows the caret asks a position's byte on every edit. The answer costs the
// position's path, so each row is held to its twin above, which types with no listener.
const READING_ROWS: Array<[shape: FixtureShape, size: string]> = [
	['many-small-blocks', '1MB'],
	['many-small-blocks', '10MB']
];

test.describe('perf gate: keystroke p50 with a listener reading a position on every edit', () => {
	for (const [shape, size] of READING_ROWS) {
		const key = `${shape}-${size}-reading`;
		test(key.replace(/-/g, ' '), async ({ page }) => {
			const { baselineMs, ceilingMs } = gateFor(key);
			const m = await measureTypingWithPositionReads(
				page,
				new EditorPage(page),
				shape,
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

// A new paragraph's first letter is the keystroke whose fix-up writes the block beside it; a write
// naming no blocks costs the listener every block, so the row is held to the letter typed alone.
test.describe('perf gate: the first letter of a new paragraph, with a listener reading a position', () => {
	test('many small blocks 1MB reading new paragraph', async ({ page }) => {
		const key = 'many-small-blocks-1MB-reading-new-paragraph';
		const m = await measureNewParagraphLetter(
			page,
			new EditorPage(page),
			'many-small-blocks',
			SIZE_BYTES['1MB'],
			SIZE_KEYSTROKES['10MB']
		);
		// The twin ran on this machine, so the runner's scale widens the millisecond floor alone.
		const ceilingMs = m.alone.p50Ms * TOLERANCE + FLOOR_MS * RUNNER_SCALE;
		console.log(
			`PERF-GATE ${key} p50=${m.reading.p50Ms.toFixed(1)}ms ` +
				`ceiling=${ceilingMs.toFixed(1)}ms (alone ${m.alone.p50Ms.toFixed(1)}ms) ` +
				`p95=${m.reading.p95Ms.toFixed(1)}ms`
		);
		expect(m.reading.p50Ms, `${key} p50 past the letter typed alone`).toBeLessThanOrEqual(
			ceilingMs
		);
	});
});

// Typing inside a container, which no row above reaches. The caret sits on the first child, always
// mounted and the only position whose keystroke moves the container's opening line.
const CONTAINER_INTERIOR_ROWS: Array<[shape: FixtureShape, leafPath: number[], size: string]> = [
	['giant-single-list', [0, 0, 0], '1MB'],
	['giant-single-blockquote', [0, 0], '1MB'],
	['giant-single-table', [0, 0, 0], '1MB'],
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

// A copy reads its range through the range-edit core, over the document's bytes and layout the
// editor makes once per content version, so a copy of a few items is timed in the largest list.
test.describe('perf gate: a copy over a range in a giant list', () => {
	test('giant single list copy 10MB', async ({ page }) => {
		const key = 'giant-single-list-copy-10MB';
		const { baselineMs, ceilingMs } = gateFor(key);
		const m = await measureListCopy(page, new EditorPage(page), SIZE_BYTES['10MB'], 3, 4, 15);
		console.log(
			`PERF-GATE ${key} p50=${m.p50Ms.toFixed(1)}ms ` +
				`ceiling=${ceilingMs.toFixed(1)}ms (baseline ${baselineMs}ms) p95=${m.p95Ms.toFixed(1)}ms ` +
				`first=${m.samples[0].toFixed(1)}ms`
		);
		expect(m.p50Ms, `${key} p50 regressed past baseline+budget`).toBeLessThanOrEqual(ceilingMs);
	});
});

// A removal over a range goes through the range-edit core and one byte splice. Its baseline is
// what the key cost before they did, so a range edit that reads the whole document reds the row.
test.describe('perf gate: a removal over a range across small blocks', () => {
	test('many small blocks 1MB range removal', async ({ page }) => {
		const key = 'many-small-blocks-1MB-range-removal';
		const m = await measureRangeRemoval(page, new EditorPage(page), SIZE_BYTES['1MB'], 20);
		// Printed ahead of the gate, so a run still shows the row while its baseline waits a bless.
		console.log(
			`PERF-GATE ${key} p50=${m.p50Ms.toFixed(1)}ms p95=${m.p95Ms.toFixed(1)}ms ` +
				`first=${m.samples[0].toFixed(1)}ms load=${m.loadMs.toFixed(1)}ms`
		);
		const { baselineMs, ceilingMs } = gateFor(key);
		console.log(`PERF-GATE ${key} ceiling=${ceilingMs.toFixed(1)}ms (baseline ${baselineMs}ms)`);
		expect(m.p50Ms, `${key} p50 regressed past baseline+budget`).toBeLessThanOrEqual(ceilingMs);
	});
});

// A copy right after a write, held to the same copy made again: what a range edit reads of a
// container is laid out once per content version, so reading the whole container reds the row.
const FIRST_COPY_ROWS: Array<[shape: GiantContainer, size: string]> = [
	['giant-single-blockquote', '1MB'],
	['giant-single-list', '1MB'],
	['giant-single-list', '10MB']
];

test.describe('perf gate: the first copy after a write in a giant container', () => {
	for (const [shape, size] of FIRST_COPY_ROWS) {
		const key = `${shape}-${size}-copy-first`;
		test(key.replace(/-/g, ' '), async ({ page }) => {
			const m = await measureFirstCopy(page, new EditorPage(page), shape, SIZE_BYTES[size], 12);
			// The twin ran on this machine, so the runner's scale widens the millisecond floor alone.
			const ceilingMs = m.again.p50Ms * TOLERANCE + FLOOR_MS * RUNNER_SCALE;
			console.log(
				`PERF-GATE ${key} p50=${m.first.p50Ms.toFixed(1)}ms ` +
					`ceiling=${ceilingMs.toFixed(1)}ms (again ${m.again.p50Ms.toFixed(1)}ms) ` +
					`p95=${m.first.p95Ms.toFixed(1)}ms`
			);
			expect(m.first.p50Ms, `${key} p50 past the same copy made again`).toBeLessThanOrEqual(
				ceilingMs
			);
		});
	}
});

// A removal over a range inside a giant quote, which a layout of the quote's every line made slow.
test.describe('perf gate: a removal over a range inside a giant quote', () => {
	test('giant single blockquote 1MB range removal', async ({ page }) => {
		const key = 'giant-single-blockquote-1MB-range-removal';
		const m = await measureContainerRangeRemoval(
			page,
			new EditorPage(page),
			'giant-single-blockquote',
			SIZE_BYTES['1MB'],
			20
		);
		// Printed ahead of the gate, so a run still shows the row while its baseline waits a bless.
		console.log(
			`PERF-GATE ${key} p50=${m.p50Ms.toFixed(1)}ms p95=${m.p95Ms.toFixed(1)}ms ` +
				`first=${m.samples[0].toFixed(1)}ms load=${m.loadMs.toFixed(1)}ms`
		);
		const { baselineMs, ceilingMs } = gateFor(key);
		console.log(`PERF-GATE ${key} ceiling=${ceilingMs.toFixed(1)}ms (baseline ${baselineMs}ms)`);
		expect(m.p50Ms, `${key} p50 regressed past baseline+budget`).toBeLessThanOrEqual(ceilingMs);
	});
});

// An edit inside a giant container, made today's way and then through the byte splice the range
// gestures move onto: reported beside each other, the today figure being the splice's parity target.
const CONTAINER_EDIT_ROWS: Array<
	[shape: GiantContainer, edit: 'paste' | 'removal', size: string, samples: number, mode?: 'live']
> = [
	['giant-single-list', 'paste', '1MB', 8],
	['giant-single-list', 'paste', '10MB', 4],
	['giant-single-blockquote', 'paste', '10MB', 4],
	['giant-single-table', 'paste', '10MB', 4],
	['giant-single-list', 'removal', '10MB', 4],
	['giant-single-blockquote', 'removal', '10MB', 4],
	['giant-single-table', 'removal', '10MB', 4],
	['giant-single-list', 'paste', '10MB', 4, 'live'],
	['giant-single-blockquote', 'paste', '10MB', 4, 'live'],
	['giant-single-table', 'paste', '10MB', 4, 'live'],
	['giant-single-list', 'removal', '10MB', 4, 'live'],
	['giant-single-blockquote', 'removal', '10MB', 4, 'live'],
	['giant-single-table', 'removal', '10MB', 4, 'live']
];

test.describe('perf report: an edit inside a giant container', () => {
	for (const [shape, edit, size, samples, mode] of CONTAINER_EDIT_ROWS) {
		const name = `${shape} interior ${edit} ${size}${mode ? ` ${mode}` : ''}`;
		test(name, async ({ page }) => {
			const m = await measureContainerEdit(page, new EditorPage(page), {
				shape,
				bytes: SIZE_BYTES[size],
				child: 3,
				edit,
				samples,
				mode: mode ?? 'source'
			});
			console.log(
				`PERF-REPORT ${name.replaceAll(' ', '-')} today p50=${m.today.p50Ms.toFixed(1)}ms ` +
					`p95=${m.today.p95Ms.toFixed(1)}ms splice p50=${m.splice.p50Ms.toFixed(1)}ms ` +
					`p95=${m.splice.p95Ms.toFixed(1)}ms load=${m.loadMs.toFixed(1)}ms`
			);
			expect(m.splice.samples).toHaveLength(samples);
		});
	}
});
