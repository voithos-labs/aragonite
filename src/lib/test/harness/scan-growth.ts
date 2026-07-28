// Growth harness for the inline scan-bounds suites. A recognizer that declines by
// scanning to the end of its block is quadratic in block size, and the wall time
// that proves it is machine-dependent — so these suites compare the same shape at N
// and 4N instead. The ratio cancels machine speed out: a bounded scan lands near 4,
// an unbounded one near 16.

/** Distinct-per-repetition tail: the scan indexes memoize on the block's raw, so a
 *  repeat of the identical string would time a cache hit, not the scan. Trailing
 *  `z` runs never complete any construct these suites flood with. */
const salt = (rep: number) => 'z'.repeat(rep);

const REPETITIONS = 3;

export interface ScanGrowth {
	/** Best-of wall time at [N, 4N], milliseconds. */
	times: [number, number];
	/** time(4N) / time(N) — near 4 when bounded, near 16 when quadratic. */
	ratio: number;
}

function bestMs(run: (source: string) => void, build: (rep: number) => string): number {
	let best = Infinity;
	for (let rep = 0; rep < REPETITIONS; rep++) {
		const source = build(rep);
		const started = performance.now();
		run(source);
		best = Math.min(best, performance.now() - started);
	}
	return best;
}

/**
 * Time `run` over `unit` repeated to each of `[smallKb, largeKb]` (a 4x step), best
 * of a few cold repetitions each.
 */
export function measureScanGrowth(
	run: (source: string) => void,
	unit: string,
	[smallKb, largeKb]: [number, number]
): ScanGrowth {
	const build = (kb: number) => (rep: number) =>
		unit.repeat(Math.ceil((kb * 1024) / unit.length)) + salt(rep);

	bestMs(run, build(smallKb)); // warm: the first sample would otherwise time JIT compilation
	const times: [number, number] = [bestMs(run, build(smallKb)), bestMs(run, build(largeKb))];
	return { times, ratio: times[1] / times[0] };
}

/** Ratio ceiling every bounded-scan assertion prices against: midway (log scale)
 *  between a linear 4x and a quadratic 16x, so neither side is a coin flip. */
export const BOUNDED_GROWTH_CEILING = 8;
