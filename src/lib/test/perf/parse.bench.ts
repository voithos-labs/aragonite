import { bench, describe } from 'vitest';
import { parse } from '../../core/parser';
import { FIXTURE_SHAPES, generateFixture } from './fixtures/generate';

const SIZES: Array<[label: string, bytes: number, opts: { iterations: number }]> = [
	['100KB', 100_000, { iterations: 10 }],
	['1MB', 1_000_000, { iterations: 5 }],
	['10MB', 10_000_000, { iterations: 2 }]
];

for (const shape of FIXTURE_SHAPES) {
	describe(`parse ${shape}`, () => {
		for (const [label, bytes, opts] of SIZES) {
			const src = generateFixture(shape, bytes);
			bench(
				label,
				() => {
					parse(src);
				},
				{ warmupIterations: 1, ...opts }
			);
		}
	});
}
