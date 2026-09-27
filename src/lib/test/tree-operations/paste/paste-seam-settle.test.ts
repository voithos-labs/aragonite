// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import {
	makeEditorActionsDeps,
	makeStubBlockEdit,
	pasteContext
} from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// Pasted blocks can stop interrupting the block above, so every commit's join check covers paste.
// Miss-analysis: GH #183, no paste test let the block above absorb what was pasted.

describe('a structural paste whose result the block above absorbs', () => {
	it('settles the join the splice disturbed', async () => {
		const { deps } = makeEditorActionsDeps(parse('- a\n\nzz\n'));
		const controller = createUndoController(deps);

		await pasteDispatch(
			{ pastedText: '    code\n\nmore\n', targetPath: [1], offset: 0 },
			pasteContext({
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: createPasteCoordinator(controller, deps.revealPath)
			})
		);

		expect(serialize(deps.doc)).toBe('- a\n\n    code\n\nmore\n\nzz\n');
		expect(describeConvergence(deps.doc)).toBeNull();
	});
});
