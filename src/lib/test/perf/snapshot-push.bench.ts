// Real undo-push path (controller.pushUndoSnapshot over harness deps). Under
// structural sharing a push copies only the top-level children/ids arrays —
// O(top-level children), not O(all nodes) — and this bench exists to pin that
// property.
//
// Vitest sets DEV, so every push also computes the integrity digest
// (~O(doc bytes)); production pushes skip it. The digestDoc rows isolate that
// share — production push ≈ push − digest. The undo stack saturates at
// MAX_UNDO during sampling, so means include the shift-at-cap: steady-state
// long-session behavior, not first-push behavior.
import { bench, describe } from 'vitest';
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
			bench(
				label,
				() => {
					controller.pushUndoSnapshot(0, 0);
				},
				{ warmupIterations: 1, ...opts }
			);
		}
	});

	describe(`digestDoc ${shape}`, () => {
		for (const { label, opts, doc } of cells) {
			bench(
				label,
				() => {
					digestDoc(doc);
				},
				{ warmupIterations: 1, ...opts }
			);
		}
	});
}
