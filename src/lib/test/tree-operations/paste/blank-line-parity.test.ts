// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { Document } from '$lib/core/nodes';
import { pasteDispatch, __getDefaultTextSurface } from '$lib/tree-operations/paste/dispatch';
import {
	__resetPasteSurfacesForTests,
	registerPasteSurface
} from '$lib/tree-operations/paste-surfaces';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { makeEditorActionsDeps, makeStubBlockEdit } from '$lib/test/harness/editor-actions';

// A pasted blank line must reach the same shape the same bytes reach by loading or typing
// (GH #20). Paste parses the clipboard, so the parser's separator rule is the whole answer.

/** Paste `clipboard` at the end of a one-paragraph document. */
async function pasteAfterX(clipboard: string): Promise<Document> {
	__resetPasteSurfacesForTests();
	registerPasteSurface(__getDefaultTextSurface('paragraph'));
	const { deps } = makeEditorActionsDeps(parse('x\n').children);

	await pasteDispatch(
		{ pastedText: clipboard, targetPath: [0], offset: 1 },
		{
			doc: deps.doc,
			blockEdit: makeStubBlockEdit(),
			controller: createPasteCoordinator(createUndoController(deps), deps.revealPath),
			undoEntry: 'own'
		}
	);
	return deps.doc;
}

const raws = (doc: Document): string[] => doc.children.map((n) => n.raw);

describe('a pasted blank line follows the parser rule', () => {
	it('pastes one separating blank as a separator, not a row', async () => {
		expect(raws(await pasteAfterX('one\n\ntwo\n'))).toEqual(['x\n', 'one\n', 'two\n']);
	});

	it('pastes a second blank as a live empty row', async () => {
		expect(raws(await pasteAfterX('one\n\n\ntwo\n'))).toEqual(['x\n', 'one\n', '\n', 'two\n']);
	});

	// Miss-analysis (clipboard-leading blank run): every parity case pasted a clipboard whose
	// first block was non-blank, so the arm treating a blank block as its own separator was
	// never driven and the pasted run landed one row short of what its bytes reload as.
	it('separates a clipboard that opens with a blank run from the block above', async () => {
		const pasted = await pasteAfterX('\n\ntail\n');
		expect(pasted.children.map((n) => [n.leadingTrivia, n.raw])).toEqual([
			['', 'x\n'],
			['\n', '\n'],
			['', '\n'],
			['', 'tail\n']
		]);
	});

	it.each([
		'one\n\ntwo\n',
		'one\n\n\ntwo\n',
		'one\n\n\n\ntwo\n',
		'\n\ntail\n',
		'\nlead\n',
		'one\n\n\n'
	])('pasting %j reaches the shape a load of its own bytes reaches', async (clipboard) => {
		const pasted = await pasteAfterX(clipboard);
		expect(raws(parse(serialize(pasted)))).toEqual(raws(pasted));
	});
});
