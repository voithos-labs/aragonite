// Growth harness for the scan-bounds suites. Wall time is machine-dependent, so these suites time
// the same shape at N and 4N: the ratio cancels machine speed out, landing near 4 when the scan is
// bounded and near 16 when it is quadratic. Both sizes are warmed (the first samples run several
// times slow), then sampled in one alternating window and priced pair by pair, so interference
// arriving mid-run cancels instead of loading whichever size it caught.
import { expect } from 'vitest';

/** Distinct-per-sample tail: the scan indexes memoize on the block's raw, so a
 *  second run of the identical string would time a cache hit, not the scan. Trailing
 *  `z` runs never complete any construct these suites flood with. */
const salt = (sample: number) => 'z'.repeat(sample);

/** Discarded samples per size — the warm-up ramp is steepest across the first two. */
const WARMUPS = 2;

/** Timed pairs per size — enough that a pair starved by a sibling suite stays out of the median. */
const REPETITIONS = 16;

/** Floor the median small sample must clear, below which a scheduler hiccup outweighs the scan. */
export const MIN_SAMPLE_MS = 2;

/** Escalation cap. Each step costs 4x the wall time for the same verdict, and past two the
 *  harness is pricing a size no suite declared. */
const MAX_ESCALATIONS = 2;

/** Ratio ceiling every bounded-scan assertion prices against: midway (log scale)
 *  between a linear 4x and a quadratic 16x, so neither side is a coin flip. */
export const BOUNDED_GROWTH_CEILING = 8;

/** Whole re-measurements a reading over the ceiling earns before it stands; the lowest ratio of
 *  them is the verdict. */
export const MAX_ATTEMPTS = 3;

export interface ScanGrowth {
	/** Median wall time at [N, 4N], milliseconds. */
	times: [number, number];
	/** Median of the per-pair time(4N) / time(N) readings. */
	ratio: number;
	/** The [N, 4N] sizes actually priced: the declared pair, or a 4x escalation of it. */
	sizesKb: [number, number];
	/** Measurements taken; past one, the reading is the lowest ratio they returned. */
	attempts: number;
}

/** `24KB=1.2ms 96KB=5.0ms ratio=4.17`; sizes read off the result so a message cannot name a size
 *  the run never measured, and times are medians, so they need not divide to the paired ratio. */
export function describeGrowth({ times, ratio, sizesKb, attempts }: ScanGrowth): string {
	const retried = attempts > 1 ? ` best of ${attempts}` : '';
	return `${sizesKb[0]}KB=${times[0].toFixed(1)}ms ${sizesKb[1]}KB=${times[1].toFixed(1)}ms ratio=${ratio.toFixed(2)}${retried}`;
}

/** The one bounded-scan verdict: every suite asserts through this, so the ceiling a reading is
 *  retried against and the ceiling it is judged against cannot drift apart. */
export function expectBoundedGrowth(growth: ScanGrowth): void {
	expect(growth.ratio, describeGrowth(growth)).toBeLessThan(BOUNDED_GROWTH_CEILING);
}

function timeMs(run: (source: string) => void, source: string, now: () => number): number {
	const started = now();
	run(source);
	return now() - started;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * How a size's body is built: a unit to repeat, or a builder for a shape repetition cannot
 * express (one construct with a long tail, a ladder of growing runs). A builder places the
 * distinctness itself, since a shape whose defect lives at its END cannot take a `z` tail.
 */
export type ScanSource = string | ((bytes: number, salt: string) => string);

/**
 * Time `run` over `source` built to each of `[smallKb, largeKb]` (a 4x step), warming and
 * sampling both sizes symmetrically, re-pricing both 4x larger while the small sample sits
 * under `MIN_SAMPLE_MS`, and re-measuring a reading that lands over the ceiling.
 */
export function measureScanGrowth(
	run: (source: string) => void,
	source: ScanSource,
	[smallKb, largeKb]: [number, number],
	/** Clock seam, so the harness's own guard can price virtual milliseconds. */
	now: () => number = () => performance.now()
): ScanGrowth {
	let sample = 0;
	// A repeated body is built once per size: rebuilding a six-figure-byte string per sample
	// would charge allocation and GC to whatever runs next. Every source is built before the
	// timer starts, so a builder's own cost is never inside a measurement either way.
	const sourceAt = (kb: number) => {
		const bytes = kb * 1024;
		if (typeof source !== 'string') return () => source(bytes, salt(sample++));
		const body = source.repeat(Math.ceil(bytes / source.length));
		return () => body + salt(sample++);
	};

	const sampleBoth = (sizes: [number, number]) => {
		const small = sourceAt(sizes[0]);
		const large = sourceAt(sizes[1]);

		for (let i = 0; i < WARMUPS; i++) {
			timeMs(run, small(), now);
			timeMs(run, large(), now);
		}

		const smalls: number[] = [];
		const larges: number[] = [];
		const ratios: number[] = [];
		for (let rep = 0; rep < REPETITIONS; rep++) {
			const smallFirst = rep % 2 === 0;
			const first = timeMs(run, smallFirst ? small() : large(), now);
			const second = timeMs(run, smallFirst ? large() : small(), now);
			const [smallMs, largeMs] = smallFirst ? [first, second] : [second, first];
			smalls.push(smallMs);
			larges.push(largeMs);
			ratios.push(largeMs / smallMs);
		}
		return { times: [median(smalls), median(larges)] as [number, number], ratio: median(ratios) };
	};

	const priceOnce = () => {
		let sizesKb: [number, number] = [smallKb, largeKb];
		let growth = sampleBoth(sizesKb);
		for (let step = 0; step < MAX_ESCALATIONS && growth.times[0] < MIN_SAMPLE_MS; step++) {
			sizesKb = [sizesKb[0] * 4, sizesKb[1] * 4];
			growth = sampleBoth(sizesKb);
		}
		return { ...growth, sizesKb };
	};

	let best = priceOnce();
	let attempts = 1;
	while (attempts < MAX_ATTEMPTS && best.ratio > BOUNDED_GROWTH_CEILING) {
		const retry = priceOnce();
		attempts++;
		if (retry.ratio < best.ratio) best = retry;
	}
	return { ...best, attempts };
}
