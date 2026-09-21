// Checks that a push costs O(top-level children), not O(all nodes), over the real controller
// path. Vitest sets `DEV`, so every push also computes the integrity digest production skips;
// the `digestDoc` rows separate it out (production is about push minus digest).
// The stack fills to `MAX_UNDO` during sampling, so the means report what a long session
// costs rather than what the first push costs.
import { describe, test } from 'vitest';
import { BENCH_TIMEOUT } from './fixtures/bench-timeout';
import { parse } from '../../core/parser';
import { createUndoController } from '../../editor-actions/commit/undo-controller';
import { digestDoc } from '../../invariants/snapshot-integrity';
import { makeEditorActionsDeps } from '../harness/editor-actions';
import { generateFixture, type FixtureShape } from './fixtures/generate';

const SHAPES: FixtureShape[] = ['nested-containers', 'flat-prose'];

const SIZES: Array<[label: string, bytes: number, opts: { time?: number }]> = [
	['100KB', 100_000, {}],
	['1MB', 1_000_000, {}],
	// Real time budget so slower rows still collect a usable sample count.
	['10MB', 10_000_000, { time: 3_000 }]
];

for (const shape of SHAPES) {
	const cells = SIZES.map(([label, bytes, opts]) => {
		const harness = makeEditorActionsDeps(parse(generateFixture(shape, bytes)).children);
		return { label, opts, doc: harness.doc, controller: createUndoController(harness.deps) };
	});

	describe(`pushUndoSnapshot ${shape}`, () => {
		for (const { label, opts, controller } of cells) {
			test(label, { timeout: BENCH_TIMEOUT }, async ({ bench }) => {
				await bench(label, () => {
					controller.pushUndoSnapshot(0, 0);
				}).run({ warmupIterations: 1, ...opts });
			});
		}
	});

	describe(`digestDoc ${shape}`, () => {
		for (const { label, opts, doc } of cells) {
			test(label, { timeout: BENCH_TIMEOUT }, async ({ bench }) => {
				await bench(label, () => {
					digestDoc(doc);
				}).run({ warmupIterations: 1, ...opts });
			});
		}
	});
}
