// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeStubBlockEdit,
	pasteContext
} from '$lib/test/harness/editor-actions';
import type { BlockListState } from '$lib/reactivity/block-list-state.svelte';

// GH #21's paste path: an inline paste at a heading's offset 0 demotes it, the fix-up merges
// the join above, and the caret must follow the byte into the merged predecessor.
// Miss-analysis: this path used settledCaretTarget's answer with no pin of its own; two waves'
// reviews proved a caret placement pinned only at the primitive keeps a caller green when it
// regresses (reverting this path's caret placement survived the full unit suite).

describe('inline paste landing after a fold above the target', () => {
	it('answers the merged predecessor and the shifted offset at top level', async () => {
		const { deps } = makeEditorActionsDeps(parse('a\n# h\nb\n').children);
		const coordinator = createPasteCoordinator(createUndoController(deps), deps.revealPath);

		const result = await pasteDispatch(
			{ pastedText: 'x', targetPath: [1], offset: 0 },
			pasteContext({
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: coordinator,
				undoEntry: 'join'
			})
		);

		expect(serialize(deps.doc)).toBe('a\nx# h\nb\n');
		expect(deps.doc.children).toHaveLength(1);
		expect(result.inlineCaretPath).toEqual([0]);
		expect(result.inlineCaretOffset).toBe(3);
	});

	it('answers the container-deep path when the fold runs inside a blockquote body', async () => {
		const { deps } = makeEditorActionsDeps(parse('> a\n> # h\n> b\n').children);
		const liveQuote = () => deps.doc.children[0];
		const state = makeBlockListState(liveQuote, ['c0', 'c1', 'c2']);
		registerBlockListState(liveQuote(), state as unknown as BlockListState);
		const coordinator = createPasteCoordinator(createUndoController(deps), deps.revealPath);

		const result = await pasteDispatch(
			{ pastedText: 'x', targetPath: [0, 1], offset: 0 },
			pasteContext({
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: coordinator,
				undoEntry: 'join'
			})
		);

		expect(serialize(deps.doc)).toBe('> a\n> x# h\n> b\n');
		expect(liveQuote().children).toHaveLength(1);
		expect(liveQuote().childIds).toHaveLength(1);
		expect(result.inlineCaretPath).toEqual([0, 0]);
		expect(result.inlineCaretOffset).toBe(3);
	});
});
