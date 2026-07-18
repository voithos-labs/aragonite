import { describe, it } from 'vitest';
import fc from 'fast-check';
import { classifyBlockForSelection, normalize, walkBetween } from '../../selection/primitives';
import { comparePaths, pathsEqual } from '../../selection/path-math';
import { allBlockPaths, arbDocWithSelection, freshOrFixedSeed } from './arbitraries';

// G2.7: the two cross-block selection primitives agree. classifyBlockForSelection
// partitions every block into start / middle / end / outside; walkBetween yields
// the strictly-between paths. The load-bearing invariant is that they cohere:
// walkBetween's output is EXACTLY the 'middle'-classified blocks, the endpoints
// classify as start/end, and walkBetween is a duplicate-free, strictly-
// increasing document-order list that excludes both endpoints. Endpoints come
// from real block paths (arbDocWithSelection) so classification is never vacuous.

const PARAMS = { numRuns: 1000, seed: freshOrFixedSeed(424242) } as const;

describe('G2.7 selection partition', () => {
	it('classifyBlockForSelection agrees with walkBetween across the whole doc', () => {
		fc.assert(
			fc.property(arbDocWithSelection, ({ doc, selection }) => {
				const { start, end } = normalize(selection);
				const between = walkBetween(doc, start.path, end.path);
				const betweenKey = new Set(between.map((p) => p.join(',')));

				for (const path of allBlockPaths(doc)) {
					const cls = classifyBlockForSelection(path, selection);
					if (pathsEqual(path, start.path)) {
						if (cls !== 'start') throw new Error(`start path classified ${cls}`);
					} else if (pathsEqual(path, end.path)) {
						if (cls !== 'end') throw new Error(`end path classified ${cls}`);
					} else if (betweenKey.has(path.join(','))) {
						if (cls !== 'middle') throw new Error(`walked path classified ${cls}, expected middle`);
					} else if (cls !== 'outside') {
						throw new Error(`non-walked path classified ${cls}, expected outside`);
					}
				}
			}),
			PARAMS
		);
	});

	it('walkBetween is strictly increasing, dup-free, and excludes endpoints', () => {
		fc.assert(
			fc.property(arbDocWithSelection, ({ doc, selection }) => {
				const { start, end } = normalize(selection);
				const between = walkBetween(doc, start.path, end.path);

				for (let i = 1; i < between.length; i++) {
					if (comparePaths(between[i - 1], between[i]) >= 0) {
						throw new Error('walkBetween not strictly increasing in document order');
					}
				}
				for (const path of between) {
					if (pathsEqual(path, start.path) || pathsEqual(path, end.path)) {
						throw new Error('walkBetween included an endpoint');
					}
				}
			}),
			PARAMS
		);
	});
});
