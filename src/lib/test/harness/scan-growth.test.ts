// The growth harness's own floor: a sub-millisecond best-of is jitter, not a measurement, so
// the harness re-prices at 4x rather than dividing two noise reads.
//
// Miss-analysis: the harness had no test of its own and its noise floor was implicit.
import { describe, it, expect } from 'vitest';
import { MIN_SAMPLE_MS, describeGrowth, measureScanGrowth } from './scan-growth';

/** A scan whose cost is exactly `msPerByte` per byte, read off its own clock: the guard
 *  prices declared sizes, never this machine, and burns no wall time doing it. */
function virtualScan(msPerByte: number) {
	let elapsed = 0;
	return {
		run: (source: string) => void (elapsed += source.length * msPerByte),
		now: () => elapsed
	};
}

/** Half the floor at 8KB, so 8KB escalates and 32KB does not. */
const HALF_FLOOR_AT_8KB = MIN_SAMPLE_MS / 16384;

describe('measureScanGrowth noise floor', () => {
	it('escalates both sizes 4x when the small sample lands under the floor', () => {
		const { run, now } = virtualScan(HALF_FLOOR_AT_8KB);
		const growth = measureScanGrowth(run, 'x', [8, 32], now);
		expect(growth.sizesKb).toEqual([32, 128]);
		expect(growth.times[0]).toBeGreaterThanOrEqual(MIN_SAMPLE_MS);
		expect(growth.ratio).toBeCloseTo(4, 1);
	});

	it('prices the declared sizes when the small sample clears the floor', () => {
		const { run, now } = virtualScan(HALF_FLOOR_AT_8KB);
		const growth = measureScanGrowth(run, 'x', [32, 128], now);
		expect(growth.sizesKb).toEqual([32, 128]);
		expect(growth.ratio).toBeCloseTo(4, 1);
	});

	it('gives up after two escalations rather than climbing to a size nobody declared', () => {
		const { run, now } = virtualScan(HALF_FLOOR_AT_8KB / 1000);
		const growth = measureScanGrowth(run, 'x', [1, 4], now);
		expect(growth.sizesKb).toEqual([16, 64]);
		expect(growth.times[0]).toBeLessThan(MIN_SAMPLE_MS);
	});
});

describe('describeGrowth', () => {
	it('names the sizes actually measured, not the ones declared', () => {
		const { run, now } = virtualScan(HALF_FLOOR_AT_8KB);
		expect(describeGrowth(measureScanGrowth(run, 'x', [8, 32], now))).toBe(
			'32KB=4.0ms 128KB=16.0ms'
		);
	});
});
