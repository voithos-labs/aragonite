// Where a keystroke's caret goes once a container above the leaf read its bytes again: in front of
// the text it was in front of, found by its byte position in the container, not its leaf offset.
// Miss-analysis: the fold rows checked a fold's index and bytes, never the caret after a fold that
// kept its index but moved the leaf's bytes (a space a widened marker took).
// Miss-analysis: every relanding row was a strip container, which the interim byte helper answered;
// for an opaque `:::` container it answered null, and the fallback was byte 0.
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { installPlugins } from '#lib';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { takeDevWarnsOf } from '#lib/test/support/warn-gate.js';
import type { CstNode } from '#lib/core/nodes.js';
import { documentLineEnding } from '#lib/core/lines.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';

/** A keystroke writing `raw` into the leaf at `leaf`, the caret at `caret`, and where it relanded. */
function typeInto(source: string, leaf: number[], raw: string, caret: number) {
	const { deps } = makeEditorActionsDeps(source);
	const owner = blockNodeAt(deps.doc, leaf.slice(0, -1)) as CstNode;
	const body = { children: owner.children!, owner, lineEnding: documentLineEnding(deps.doc) };
	const write = legalizeWrite(body, leaf[leaf.length - 1], raw, 'authored', defaultGrammarView);
	const typed = createUndoController(deps).typeLeaf(docPathFrom(leaf), write, caret);
	if (!typed.wrote) throw new Error('the keystroke wrote nothing');
	return { deps, caret: typed.relanding?.caret ?? { path: leaf, offset: caret } };
}

describe('a keystroke relands in front of the text once a container re-reads it', () => {
	it.each([
		{ name: 'a top-level item whose follower leaves it', source: '- ab\n\n  b\n', leaf: [0, 0, 0] },
		{ name: 'an item in a quote', source: '> - ab\n>\n>   b\n', leaf: [0, 0, 0, 0] },
		{ name: 'a second-level item', source: '- x\n  - ab\n\n    b\n', leaf: [0, 0, 1, 0, 0] }
	])('$name', ({ source, leaf }) => {
		// A space typed at the content start, the caret after it.
		const { deps, caret } = typeInto(source, leaf, ' ab\n', 1);
		const landed = blockNodeAt(deps.doc, caret.path) as CstNode;
		expect(landed.raw.slice(caret.offset)).toMatch(/^ab/);
	});
});

// A `:::` fence grows when a line in it needs a longer one; the caret stays where the key typed,
// never at the outer container's first byte (G1.237).
describe('a keystroke relands where it typed once a `:::` fence grows around it', () => {
	beforeEach(() => installPlugins([admonitionsPlugin()]));

	const NESTED = '::::note Outer\n:::tip Inner\nin\n:::\n::::\n';
	it.each([
		{
			name: 'a closing line typed in a body',
			source: ':::note\nbody\n\n::\n:::\n',
			leaf: [0, 2],
			raw: ':::\n',
			at: 3
		},
		{
			name: 'a colon at a nested row start',
			source: NESTED,
			leaf: [0, 1, 0],
			raw: '::::tip Inner\n',
			at: 1
		},
		{
			name: 'a colon in a nested row marker',
			source: NESTED,
			leaf: [0, 1, 0],
			raw: '::::tip Inner\n',
			at: 4
		}
	])('$name', ({ source, leaf, raw, at }) => {
		const { caret } = typeInto(source, leaf, raw, at);
		expect(caret).toEqual({ path: leaf, offset: at });
		expect(takeDevWarnsOf('relanding-byte')).toEqual([]);
	});
});
