// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeStubBlockEdit,
	pasteContext
} from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';

// Replacing a blank blockquote body block wholesale must keep the separator it carried.
// Miss-analysis: GH #73, the empty-target cases used a hand-emptied stub, which separates nothing.

describe('container-matching paste over a blank body block', () => {
	it('separates both the spliced head and the block below it', async () => {
		const { deps } = makeEditorActionsDeps(parse('> a\n>\n>\n> b\n').children);
		const quote = deps.doc.children[0];
		expect(quote.children!.map((n) => [n.leadingTrivia, n.raw])).toEqual([
			['', 'a\n'],
			['\n', '\n'],
			['', 'b\n']
		]);
		const controller = createUndoController(deps);
		registerBlockListState(
			quote,
			makeBlockListState(() => deps.doc.children[0])
		);

		await pasteDispatch(
			{ pastedText: '> X\n>\n> Y\n', targetPath: [0, 1], offset: 0 },
			pasteContext({
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: createPasteCoordinator(controller, deps.revealPath)
			})
		);

		expect(serialize(deps.doc)).toBe('> a\n>\n> X\n>\n> Y\n>\n> b\n');
		expectParseConverged(deps.doc);
	});
});
