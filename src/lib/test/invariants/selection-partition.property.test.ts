import { describe, it } from 'vitest';
import fc from 'fast-check';
import { classifyBlockForSelection, normalize } from '../../selection/primitives';
import { coverRange, rangeCoverage, walkBetween } from '../../selection/range-coverage';
import {
	comparePaths,
	isStrictAncestorOf,
	pathHasPrefix,
	pathsEqual
} from '../../selection/path-math';
import { allBlockPaths, arbDocWithSelection, freshOrFixedSeed } from './arbitraries';
import type { DocumentView } from '../../core/node-views';
import { nodeAt } from '../../tree-operations/node-primitives';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { countsCells } from '../../schema/block-kind-descriptor';

// The overlay's classes come off the one coverage, and that coverage splits the range cleanly:
// every block strictly between the endpoints sits in exactly one whole root, inside a kept edge,
// or is an ancestor of the end's block. Endpoints are real block paths, so no case is vacuous.

const PARAMS = { numRuns: 1000, seed: freshOrFixedSeed(424242) } as const;

const opensOnto = (doc: DocumentView, path: number[]): boolean => {
	const node = nodeAt(doc, path);
	return node !== null && (node.children?.length ?? 0) > 0 && !countsCells(node);
};

describe('G2.7 selection partition', () => {
	it('classifyBlockForSelection reads the coverage, and the coverage partitions the range', () => {
		fc.assert(
			fc.property(arbDocWithSelection, ({ doc, selection }) => {
				// Stored the way every gesture stores a pair, so a table endpoint counts cells.
				const state = createSelectionState({ getDoc: () => doc });
				state.enterCrossBlock(selection.anchor, selection.focus);
				const { anchor, focus } = state;
				if (!anchor || !focus) return;
				const coverage = rangeCoverage(doc, coverRange(doc, anchor, focus));
				const { start, end } = coverage.range;
				// A container's own path is no position a range starts or ends at: the stored endpoints
				// are leaves, tables and blocks held whole.
				if (pathsEqual(start.path, end.path) || [start, end].some((p) => opensOnto(doc, p.path)))
					return;
				const keptEdges = [coverage.startEdge, coverage.endEdge].flatMap((edge) =>
					edge ? [edge.path] : []
				);

				for (const path of allBlockPaths(doc)) {
					const root = coverage.rootHolding(path);
					const expected = root
						? pathsEqual(root, path)
							? 'middle'
							: 'outside'
						: coverage.startEdge && pathsEqual(path, start.path)
							? 'start'
							: coverage.endEdge && pathsEqual(path, end.path)
								? 'end'
								: 'outside';
					const cls = classifyBlockForSelection(path, coverage);
					if (cls !== expected) throw new Error(`${path} classified ${cls}, expected ${expected}`);
				}
				for (const path of walkBetween(doc, start.path, end.path)) {
					const roots = coverage.wholeRoots.filter((root) => pathHasPrefix(path, root));
					// A container above an endpoint is only partly held; a table edge's own rows follow it
					// in document order and belong to its kept part.
					const byEdge =
						isStrictAncestorOf(path, end.path) ||
						keptEdges.some((edge) => pathHasPrefix(path, edge));
					if (roots.length > 1 || (roots.length === 0 && !byEdge)) {
						throw new Error(`${path} sits in ${roots.length} roots, by an edge: ${byEdge}`);
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
