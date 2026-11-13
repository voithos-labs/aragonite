// @vitest-environment jsdom
// G1.209 over drawn writes: with the record measured, after every operation of a random run of
// real action-factory operations, undo and redo among them, the bytes the editor keeps for every
// top-level block are the tree's and every start is a fresh measure's. The dev guard compares the
// same strings at each announcement inside an operation, and its warning fails the run.
// Miss-analysis: the guard compared lengths, so a run of writes that kept a block's length could
// leave its kept bytes behind with nothing to say so.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { freshOrFixedSeed } from '../invariants/arbitraries';
import { arbOp, arbSource, makeHarness, runOp } from '../undo/restoration-ops';
import { takeDevWarns } from '../support/warn-gate';

const PARAMS = { numRuns: 60, seed: freshOrFixedSeed(20261113) } as const;

describe('G1.209 the kept bytes are the document’s after every drawn write', () => {
	it('every block vouched, every start a fresh measure’s', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbSource,
				fc.array(arbOp, { minLength: 1, maxLength: 12 }),
				async (source, ops) => {
					const h = makeHarness(source);
					const ends = () => {
						const { doc, starts } = h.deps.bytes.measured();
						return doc.children.map((_, i) => starts.end(i));
					};
					// Asked first, so the record is measured and each write has blocks to name.
					ends();
					for (const op of ops) {
						await runOp(h, op);
						const count = h.deps.doc.children.length;
						expect(h.deps.starts.isMeasured() ? h.deps.starts.vouch(0, count - 1) : true).toBe(
							true
						);
						const fresh = measured(h.deps.doc).starts;
						expect(ends()).toEqual(h.deps.doc.children.map((_, i) => fresh.end(i)));
					}
					// Other guards' warnings belong to their own suites.
					const stale = takeDevWarns().filter(
						(warn) => warn.tag === 'invariant:kept-starts-current'
					);
					expect(stale).toEqual([]);
				}
			),
			PARAMS
		);
	});
});
