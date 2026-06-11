// cloneDocument is the per-commit undo-snapshot path — its cost scales with doc size.
// Vitest sets DEV, so cloneNode runs the clone-safe-metadata invariant per
// metadata-bearing node — these numbers are upper bounds vs production.
import { bench, describe } from 'vitest';
import { parse } from '../../core/parser';
import { cloneDocument } from '../../tree-operations/clone';
import { FIXTURE_SHAPES, generateFixture } from './fixtures/generate';

const SIZES: Array<[label: string, bytes: number, opts: { iterations?: number; time?: number }]> =
	[
		['100KB', 100_000, { iterations: 3 }],
		['1MB', 1_000_000, { iterations: 3 }],
		// Real time budget so ~400ms clones still collect a usable sample count.
		['10MB', 10_000_000, { time: 3_000 }]
	];

for (const shape of FIXTURE_SHAPES) {
	describe(`cloneDocument ${shape}`, () => {
		for (const [label, bytes, opts] of SIZES) {
			const doc = parse(generateFixture(shape, bytes));
			bench(
				label,
				() => {
					cloneDocument(doc);
				},
				{ warmupIterations: 1, ...opts }
			);
		}
	});
}
