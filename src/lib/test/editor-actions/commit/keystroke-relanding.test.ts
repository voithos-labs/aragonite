// Where a keystroke's caret goes once a container above the leaf read its bytes again: in front of
// the text it was in front of, found by its byte position in the container, not its leaf offset.
// Miss-analysis: the fold rows checked a fold's index and bytes, never the caret after a fold that
// kept its index but moved the leaf's bytes (a space a widened marker took).
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { describe, it, expect } from 'vitest';
import type { CstNode } from '#lib/core/nodes.js';
import { documentLineEnding } from '#lib/core/lines.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';

describe('a keystroke relands in front of the text once a container re-reads it', () => {
	it.each([
		{ name: 'a top-level item whose follower leaves it', source: '- ab\n\n  b\n', leaf: [0, 0, 0] },
		{ name: 'an item in a quote', source: '> - ab\n>\n>   b\n', leaf: [0, 0, 0, 0] },
		{ name: 'a second-level item', source: '- x\n  - ab\n\n    b\n', leaf: [0, 0, 1, 0, 0] }
	])('$name', ({ source, leaf }) => {
		const { deps } = makeEditorActionsDeps(source);
		const owner = blockNodeAt(deps.doc, leaf.slice(0, -1)) as CstNode;
		const body = { children: owner.children!, owner, lineEnding: documentLineEnding(deps.doc) };
		const index = leaf[leaf.length - 1];
		// A space typed at the content start, the caret after it.
		const write = legalizeWrite(body, index, ' ab\n', 'authored', defaultGrammarView);

		const typed = createUndoController(deps).typeLeaf(docPathFrom(leaf), write, 1);

		if (!typed.wrote) throw new Error('the keystroke wrote nothing');
		const caret = typed.relanding?.caret ?? { path: leaf, offset: 1 };
		const landed = blockNodeAt(deps.doc, caret.path) as CstNode;
		expect(landed.raw.slice(caret.offset)).toMatch(/^ab/);
	});
});
