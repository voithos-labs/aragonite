// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { makeEditorActionsDeps, makeStubBlockEdit } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// GH #183: no paste route asked the seam, so a clipboard whose landed blocks stop interrupting the
// neighbour above them left the live tree one block richer than its reload. The ask now sits beside
// the splice settle every commit crosses, so paste inherits it rather than carrying it per route.
// Miss-analysis: the paste suites assert the bytes and the landing; convergence was checked only
// where the CLIPBOARD's own trivia was the subject, never where the target's neighbour could
// absorb what landed.

describe('a structural paste whose result the block above absorbs', () => {
	it('settles the seam the splice disturbed', async () => {
		const { deps } = makeEditorActionsDeps(parse('- a\n\nzz\n'));
		const controller = createUndoController(deps);

		await pasteDispatch(
			{ pastedText: '    code\n\nmore\n', targetPath: [1], offset: 0 },
			{
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: createPasteCoordinator(controller, deps.revealPath),
				undoEntry: 'own'
			}
		);

		expect(serialize(deps.doc)).toBe('- a\n\n    code\n\nmore\n\nzz\n');
		expect(describeConvergence(deps.doc)).toBeNull();
	});
});
