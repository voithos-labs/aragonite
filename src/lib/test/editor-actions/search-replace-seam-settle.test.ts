import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createSearchReplace } from '$lib/editor-actions/search-replace';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// GH #183: search's replace committed a bare splice, so bytes that stopped interrupting the block
// above them left the live tree diverging from its own reload with nothing at the door noticing.
// The ask now lives beside the settle every commit crosses, so this door inherits it.
// Miss-analysis: the replace suites assert bytes and events; convergence was never read after a
// replace, and no fixture put a replaced block under a neighbour that could absorb it.

describe('a replace whose result the block above absorbs', () => {
	it('settles the seam the splice disturbed', async () => {
		const { deps } = makeEditorActionsDeps(parse('- a\n\nxx\n'));
		const sr = createSearchReplace(deps, createUndoController(deps));

		await sr.replaceOne({ path: [1], start: 0, end: 2 }, '  b');

		expect(serialize(deps.doc)).toBe('- a\n\n  b\n');
		expect(describeConvergence(deps.doc)).toBeNull();
	});
});
