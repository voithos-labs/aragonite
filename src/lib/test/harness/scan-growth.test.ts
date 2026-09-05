// The growth harness's own calibration: a floor under the small sample, an estimator that reads a
// linear scan as linear even while interference scales with sample duration, and the power to still
// call a quadratic scan quadratic.
//
// Miss-analysis: the harness had no test of its own — its noise floor was implicit and no case ever
// sampled it under load, so the duration bias in a best-of only surfaced on a slow CI runner.
import { describe, it, expect } from 'vitest';
import {
	BOUNDED_GROWTH_CEILING,
	MAX_ATTEMPTS,
	MIN_SAMPLE_MS,
	describeGrowth,
	measureScanGrowth
} from './scan-growth';

type CostMs = (bytes: number) => number;

const linear =
	(msPerByte: number): CostMs =>
	(bytes) =>
		bytes * msPerByte;
const quadratic =
	(msPerByteSquared: number): CostMs =>
	(bytes) =>
		bytes * bytes * msPerByteSquared;

/** A scan of a declared cost, read off its own clock: the guard prices declared sizes, never
 *  this machine, and burns no wall time doing it. */
function virtualScan(cost: CostMs, stalls: (durationMs: number) => number = () => 0) {
	let elapsed = 0;
	return {
		run: (source: string) => {
			const duration = cost(source.length);
			elapsed += duration + stalls(duration) * STALL_MS;
		},
		now: () => elapsed
	};
}

/** Stationary interference: every millisecond of work stalls on a coin flip, so a stall-free run
 *  is rarer the longer the run — the asymmetry a best-of estimator reads as growth. */
const STALL_MS = 4;
function stallStream(seed: number) {
	let state = seed >>> 0;
	const stalled = () => {
		state ^= state << 13;
		state >>>= 0;
		state ^= state >>> 17;
		state ^= state << 5;
		state >>>= 0;
		return (state & 1) === 0;
	};
	return (durationMs: number) => {
		let stalls = 0;
		for (let ms = Math.floor(durationMs); ms > 0; ms--) if (stalled()) stalls++;
		return stalls;
	};
}

/** Half the floor at 8KB, so 8KB escalates and 32KB does not. */
const HALF_FLOOR_AT_8KB = MIN_SAMPLE_MS / 16384;

/** 32KB costs 4ms and 128KB 16ms, clear of the floor either way. */
const CLEARS_FLOOR_AT_32KB = 4 / 32768;

describe('measureScanGrowth noise floor', () => {
	it('escalates both sizes 4x when the small sample lands under the floor', () => {
		const { run, now } = virtualScan(linear(HALF_FLOOR_AT_8KB));
		const growth = measureScanGrowth(run, 'x', [8, 32], now);
		expect(growth.sizesKb).toEqual([32, 128]);
		expect(growth.times[0]).toBeGreaterThanOrEqual(MIN_SAMPLE_MS);
		expect(growth.ratio).toBeCloseTo(4, 1);
	});

	it('prices the declared sizes when the small sample clears the floor', () => {
		const { run, now } = virtualScan(linear(HALF_FLOOR_AT_8KB));
		const growth = measureScanGrowth(run, 'x', [32, 128], now);
		expect(growth.sizesKb).toEqual([32, 128]);
		expect(growth.ratio).toBeCloseTo(4, 1);
	});

	it('gives up after two escalations rather than climbing to a size nobody declared', () => {
		const { run, now } = virtualScan(linear(HALF_FLOOR_AT_8KB / 1000));
		const growth = measureScanGrowth(run, 'x', [1, 4], now);
		expect(growth.sizesKb).toEqual([16, 64]);
		expect(growth.times[0]).toBeLessThan(MIN_SAMPLE_MS);
	});
});

describe('measureScanGrowth calibration', () => {
	it('separates a linear scan from a quadratic one across the ceiling', () => {
		const bounded = virtualScan(linear(CLEARS_FLOOR_AT_32KB));
		const grows = virtualScan(quadratic(CLEARS_FLOOR_AT_32KB / 32768));
		const linearGrowth = measureScanGrowth(bounded.run, 'x', [32, 128], bounded.now);
		const quadraticGrowth = measureScanGrowth(grows.run, 'x', [32, 128], grows.now);
		expect(linearGrowth.ratio).toBeCloseTo(4, 1);
		expect(linearGrowth.ratio).toBeLessThan(BOUNDED_GROWTH_CEILING);
		expect(linearGrowth.attempts).toBe(1);
		expect(quadraticGrowth.ratio).toBeCloseTo(16, 0);
		expect(quadraticGrowth.ratio).toBeGreaterThan(BOUNDED_GROWTH_CEILING);
		// Re-measurement is what a contended runner earns; a quadratic scan spends every attempt
		// and the verdict stands.
		expect(quadraticGrowth.attempts).toBe(MAX_ATTEMPTS);
	});

	// The runner failure this guards: a linear scan priced on a loaded box. Interference lands in
	// proportion to a sample's length, so the estimator alone has to read 4 — no retry to lean on.
	it('reads a linear scan as linear while interference scales with sample duration', () => {
		const loaded = virtualScan(linear(CLEARS_FLOOR_AT_32KB), stallStream(2654435761));
		const growth = measureScanGrowth(loaded.run, 'x', [32, 128], loaded.now);
		expect(growth.ratio, describeGrowth(growth)).toBeLessThan(BOUNDED_GROWTH_CEILING);
		expect(growth.ratio, describeGrowth(growth)).toBeCloseTo(4, 0);
		expect(growth.attempts).toBe(1);
	});
});

describe('describeGrowth', () => {
	it('names the sizes actually measured, not the ones declared', () => {
		const { run, now } = virtualScan(linear(HALF_FLOOR_AT_8KB));
		expect(describeGrowth(measureScanGrowth(run, 'x', [8, 32], now))).toBe(
			'32KB=4.0ms 128KB=16.0ms ratio=3.99'
		);
	});
});
