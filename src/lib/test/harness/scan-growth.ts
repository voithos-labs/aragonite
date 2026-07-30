// Growth harness for the inline scan-bounds suites. A recognizer that declines by
// scanning to the end of its block is quadratic in block size, and the wall time
// that proves it is machine-dependent — so these suites compare the same shape at N
// and 4N instead. The ratio cancels machine speed out: a bounded scan lands near 4,
// an unbounded one near 16.
//
// A ratio is only as trustworthy as the symmetry between its two measurements, and
// under parallel test workers an asymmetry does not average out: it lands on one
// size and fabricates growth. Two are designed out here.
//
//   Warm-up. The first samples at a size run several times slower than its settled
//   cost, so a size whose timed samples are its first ones reports the ramp instead
//   of the cost. Both sizes are warmed, not just one.
//
//   Drift. Load arriving between the two sizes' sample windows lands entirely on
//   whichever is measured second. The sizes are sampled inside the same window,
//   alternating which goes first so intra-window drift cancels across repetitions.
//
// Min-over-repetitions sits on top of both: contention only ever inflates, so the
// minimum converges on the true cost. It cannot substitute for the symmetry work —
// a min over samples that are all cold is still a cold measurement.

/** Distinct-per-sample tail: the scan indexes memoize on the block's raw, so a
 *  second run of the identical string would time a cache hit, not the scan. Trailing
 *  `z` runs never complete any construct these suites flood with. */
const salt = (sample: number) => 'z'.repeat(sample);

/** Discarded samples per size — the warm-up ramp is steepest across the first two. */
const WARMUPS = 2;

/** Timed samples per size; the minimum of these is the size's reported cost. */
const REPETITIONS = 4;

export interface ScanGrowth {
	/** Best-of wall time at [N, 4N], milliseconds. */
	times: [number, number];
	/** time(4N) / time(N) — near 4 when bounded, near 16 when quadratic. */
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
