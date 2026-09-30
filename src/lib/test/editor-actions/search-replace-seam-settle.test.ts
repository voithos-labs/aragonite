import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createSearchReplace } from '$lib/editor-actions/search-replace';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// A replace whose bytes stop interrupting the block above must leave a tree that matches its
// own reload; the blank-line fix-up every commit runs covers the replace path too.
// Miss-analysis (GH #183): no replace test read convergence under a neighbour that could absorb.

describe('a replace whose result the block above absorbs', () => {
	it('settles the join the splice disturbed', async () => {
		const { deps } = makeEditorActionsDeps(parse('- a\n\nxx\n'));
		const sr = createSearchReplace(deps, createUndoController(deps));

		await sr.replaceOne({ path: [1], start: 0, end: 2 }, '  b');

		expect(serialize(deps.doc)).toBe('- a\n\n  b\n');
		expect(describeConvergence(deps.doc)).toBeNull();
	});
});
