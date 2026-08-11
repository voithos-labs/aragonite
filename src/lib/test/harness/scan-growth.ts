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

export interface ScanGrowth {
	/** Best-of wall time at [N, 4N], milliseconds. */
	times: [number, number];
	/** time(4N) / time(N). */
	ratio: number;
}

function timeMs(run: (source: string) => void, source: string): number {
	const started = performance.now();
	run(source);
	return performance.now() - started;
}

/**
 * Time `run` over `unit` repeated to each of `[smallKb, largeKb]` (a 4x step),
 * warming and sampling both sizes symmetrically.
 */
export function measureScanGrowth(
	run: (source: string) => void,
	unit: string,
	[smallKb, largeKb]: [number, number]
): ScanGrowth {
	let sample = 0;
	// The repeated body is built once per size: rebuilding a six-figure-byte string
	// per sample would charge allocation and GC to whatever runs next.
	const sourceAt = (kb: number) => {
		const body = unit.repeat(Math.ceil((kb * 1024) / unit.length));
		return () => body + salt(sample++);
	};
	const small = sourceAt(smallKb);
	const large = sourceAt(largeKb);

	for (let i = 0; i < WARMUPS; i++) {
		timeMs(run, small());
		timeMs(run, large());
	}

	let smallBest = Infinity;
	let largeBest = Infinity;
	for (let rep = 0; rep < REPETITIONS; rep++) {
		if (rep % 2 === 0) {
			smallBest = Math.min(smallBest, timeMs(run, small()));
			largeBest = Math.min(largeBest, timeMs(run, large()));
		} else {
			largeBest = Math.min(largeBest, timeMs(run, large()));
			smallBest = Math.min(smallBest, timeMs(run, small()));
		}
	}
	return { times: [smallBest, largeBest], ratio: largeBest / smallBest };
}

/** Ratio ceiling every bounded-scan assertion prices against: midway (log scale)
 *  between a linear 4x and a quadratic 16x, so neither side is a coin flip. */
export const BOUNDED_GROWTH_CEILING = 8;
