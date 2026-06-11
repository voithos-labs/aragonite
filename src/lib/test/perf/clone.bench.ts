// cloneDocument is the per-commit undo-snapshot path — its cost scales with doc size.
import { bench, describe } from 'vitest';
import { parse } from '../../core/parser';
import { cloneDocument } from '../../tree-operations/clone';
import { FIXTURE_SHAPES, generateFixture } from './fixtures/generate';

const SIZES = [
	['100KB', 100_000],
	['1MB', 1_000_000],
	['10MB', 10_000_000]
] as const;

for (const shape of FIXTURE_SHAPES) {
	describe(`cloneDocument ${shape}`, () => {
		for (const [label, bytes] of SIZES) {
			const doc = parse(generateFixture(shape, bytes));
			bench(
				label,
				() => {
					cloneDocument(doc);
				},
				{ warmupIterations: 1, iterations: 3 }
			);
		}
	});
}
