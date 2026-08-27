// Growth harness for the inline scan-bounds suites. Wall time is machine-dependent,
// so these suites time the same shape at N and 4N: the ratio cancels machine speed
// out, landing near 4 when the scan is bounded and near 16 when it is quadratic.
// Under parallel workers an asymmetry between the two measurements does not average
// out — it lands on one size and fabricates growth. Hence both sizes are warmed (the
// first samples run several times slow), and sampled in one alternating window so
// drift arriving mid-run cancels instead of loading whichever went second.

/** Distinct-per-sample tail: the scan indexes memoize on the block's raw, so a
 *  second run of the identical string would time a cache hit, not the scan. Trailing
 *  `z` runs never complete any construct these suites flood with. */
const salt = (sample: number) => 'z'.repeat(sample);

/** Discarded samples per size — the warm-up ramp is steepest across the first two. */
const WARMUPS = 2;

/** Timed samples per size; the minimum of these is the size's reported cost. Sixteen, not four:
 *  a battery starves the longer size's windows first, and four reached 7.7 against a ceiling of 8. */
const REPETITIONS = 16;

/** Below this, a best-of is jitter rather than a measurement: at a fraction of a millisecond
 *  a single scheduler hiccup in either sample fabricates growth the scan never had. */
export const MIN_SAMPLE_MS = 2;

/** Escalation cap. Past two 4x steps the samples run long enough that best-of starts favoring
 *  the shorter size, since a clean window is rarer the longer it has to stay clean. */
const MAX_ESCALATIONS = 2;

export interface ScanGrowth {
	/** Best-of wall time at [N, 4N], milliseconds. */
	times: [number, number];
	/** time(4N) / time(N). */
	ratio: number;
	/** The [N, 4N] sizes actually priced: the declared pair, or a 4x escalation of it. */
	sizesKb: [number, number];
}

/** `24KB=1.2ms 96KB=5.0ms`, with the sizes read off the result so a failure message cannot
 *  name a size the run never measured. */
export function describeGrowth({ times, sizesKb }: ScanGrowth): string {
	return `${sizesKb[0]}KB=${times[0].toFixed(1)}ms ${sizesKb[1]}KB=${times[1].toFixed(1)}ms`;
}

function timeMs(run: (source: string) => void, source: string, now: () => number): number {
	const started = now();
	run(source);
	return now() - started;
}

/**
 * How a size's body is built: a unit to repeat, or a builder for a shape repetition cannot
 * express (one construct with a long tail, a ladder of growing runs). A builder places the
 * distinctness itself, since a shape whose defect lives at its END cannot take a `z` tail.
 */
export type ScanSource = string | ((bytes: number, salt: string) => string);

/**
 * Time `run` over `source` built to each of `[smallKb, largeKb]` (a 4x step), warming and
 * sampling both sizes symmetrically, and re-pricing both 4x larger while the small sample
 * sits under `MIN_SAMPLE_MS`.
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

	const sampleBoth = (sizes: [number, number]): [number, number] => {
		const small = sourceAt(sizes[0]);
		const large = sourceAt(sizes[1]);

		for (let i = 0; i < WARMUPS; i++) {
			timeMs(run, small(), now);
			timeMs(run, large(), now);
		}

		let smallBest = Infinity;
		let largeBest = Infinity;
		for (let rep = 0; rep < REPETITIONS; rep++) {
			if (rep % 2 === 0) {
				smallBest = Math.min(smallBest, timeMs(run, small(), now));
				largeBest = Math.min(largeBest, timeMs(run, large(), now));
			} else {
				largeBest = Math.min(largeBest, timeMs(run, large(), now));
				smallBest = Math.min(smallBest, timeMs(run, small(), now));
			}
		}
		return [smallBest, largeBest];
	};

	let sizesKb: [number, number] = [smallKb, largeKb];
	let times = sampleBoth(sizesKb);
	for (let step = 0; step < MAX_ESCALATIONS && times[0] < MIN_SAMPLE_MS; step++) {
		sizesKb = [sizesKb[0] * 4, sizesKb[1] * 4];
		times = sampleBoth(sizesKb);
	}
	return { times, ratio: times[1] / times[0], sizesKb };
}

/** Ratio ceiling every bounded-scan assertion prices against: midway (log scale)
 *  between a linear 4x and a quadratic 16x, so neither side is a coin flip. */
export const BOUNDED_GROWTH_CEILING = 8;
