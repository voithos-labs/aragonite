import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { rangeDelete } from '../../selection/range-delete';
import { createSharingState } from '../../tree-operations/sharing';
import { describeConvergence } from '../harness/parse-converged';

// GH #54: the same-block arm writes the joined bytes in place, so parse-owned metadata must
// re-derive at the write door or the live node drifts from what its bytes parse to.
// Miss-analysis: every same-block delete pin asserted bytes and caret, never the metadata the
// convergence oracle reads, so a stale heading level rode green suites until the #45 sweep.

describe('a same-block delete re-derives parse-owned metadata (GH #54)', () => {
	it('deleting a marker byte from a heading refreshes its level', () => {
		const doc = parse('## ab\n');

		rangeDelete(
			doc,
			{ path: [0], offset: 1 },
			{ path: [0], offset: 2 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		expect(doc.children[0].raw).toBe('# ab\n');
		expect(doc.children[0].metadata).toMatchObject({ level: 1 });
		expect(describeConvergence(doc)).toBeNull();
	});
});
