import { describe, test } from 'vitest';
import { BENCH_TIMEOUT } from './fixtures/bench-timeout';
import { parse } from '../../core/parser';
import { FIXTURE_SHAPES, generateFixture } from './fixtures/generate';

const SIZES: Array<[label: string, bytes: number, opts: { iterations?: number; time?: number }]> = [
	['100KB', 100_000, { iterations: 10 }],
	['1MB', 1_000_000, { iterations: 5 }],
	// Real time budget so ~400ms parses still collect a usable sample count.
	['10MB', 10_000_000, { time: 3_000 }]
];

for (const shape of FIXTURE_SHAPES) {
	describe(`parse ${shape}`, () => {
		for (const [label, bytes, opts] of SIZES) {
			const src = generateFixture(shape, bytes);
			test(label, { timeout: BENCH_TIMEOUT }, async ({ bench }) => {
				await bench(label, () => {
					parse(src);
				}).run({ warmupIterations: 1, ...opts });
			});
		}
	});
}
