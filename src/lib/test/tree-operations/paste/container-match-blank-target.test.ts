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
	makeStubBlockEdit
} from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';

// GH #73, the fifth seam: the container-match gate runs FIRST and its empty-target arm replaces
// the child wholesale, while a blockquote body block can be blank.
// Miss-analysis: the empty-target cases stand a post-delete stub (raw emptied by hand) in for the
// target, and a stub is not a blank LINE — it separated nothing, so no case could observe the
// separator a real blank block carries. The case ran against a hand-rolled commit double until
// the settle moved into the ceremony, where only the real controller crosses it.

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
			{
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: createPasteCoordinator(controller, deps.revealPath),
				undoEntry: 'own'
			}
		);

		expect(serialize(deps.doc)).toBe('> a\n>\n> X\n>\n> Y\n>\n> b\n');
		expectParseConverged(deps.doc);
	});
});
