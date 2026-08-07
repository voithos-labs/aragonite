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
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { splitNode } from '$lib/tree-operations/node-ops';
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

/** Paste `clipboard` at the head of block `index` of a live document. */
async function pasteAtHeadOf(doc: Document, index: number, clipboard: string): Promise<Document> {
	__resetPasteSurfacesForTests();
	registerPasteSurface(__getDefaultTextSurface('paragraph'));
	const { deps } = makeEditorActionsDeps(doc.children);
	const controller = createUndoController(deps);

	await pasteDispatch(
		{ pastedText: clipboard, targetPath: [index], offset: 0 },
		{
			doc: deps.doc,
			blockEdit: createBlockEditActions(deps, controller),
			controller: createPasteCoordinator(controller, deps.revealPath),
			undoEntry: 'own'
		}
	);
	return deps.doc;
}

const raws = (doc: Document): string[] => doc.children.map((n) => n.raw);

const layout = (doc: Document): [string, string][] =>
	doc.children.map((n) => [n.leadingTrivia, n.raw]);

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

// GH #73: a blank block IS the separating line of the block below it, so pasting over one takes
// that line away from a follower nobody re-mints it for. Two byte-equivalent shapes reach the
// slot — a load puts the separator on the blank's own trivia, an Enter split puts it on the
// follower's — and the settle has to answer for both.
// Miss-analysis: every parity case above pastes at the document TAIL, where the target has no
// follower at all, so the arm that loses one was unreachable.
describe('pasting over a blank line settles the separators it consumed', () => {
	it('hands the follower back the line a load-shaped blank slot was holding', async () => {
		const pasted = await pasteAtHeadOf(parse('alpha\n\n\ndelta\n'), 1, 'X\n\nY\n');

		expect(serialize(pasted)).toBe('alpha\n\nX\n\nY\n\ndelta\n');
		expect(layout(parse(serialize(pasted)))).toEqual(layout(pasted));
	});

	// The split shape leaves the follower already separated and the SLOT holding nothing, so the
	// same paste strands the replacement head against the block above instead.
	it('hands the replacement head the line a split-shaped blank slot was holding', async () => {
		const split = parse('alpha\n\ndelta\n');
		splitNode(split, 0, 5);
		expect(layout(split)).toEqual([
			['', 'alpha\n'],
			['', '\n'],
			['\n', 'delta\n']
		]);

		const pasted = await pasteAtHeadOf(split, 1, 'X\n\nY\n');

		expect(serialize(pasted)).toBe('alpha\n\nX\n\nY\n\ndelta\n');
		expect(layout(parse(serialize(pasted)))).toEqual(layout(pasted));
	});

	it('takes a CRLF document its own line endings', async () => {
		const pasted = await pasteAtHeadOf(parse('alpha\r\n\r\n\r\ndelta\r\n'), 1, 'X\r\n\r\nY\r\n');

		expect(serialize(pasted)).toBe('alpha\r\n\r\nX\r\n\r\nY\r\n\r\ndelta\r\n');
		expect(serialize(pasted)).not.toContain('\n\n');
	});

	// A single-paragraph clipboard routes inline, through `updateNodeContent` rather than the
	// splice — the same class, a different seam.
	it('settles the follower on the inline route too', async () => {
		const pasted = await pasteAtHeadOf(parse('alpha\n\n\ndelta\n'), 1, 'just text');

		expect(serialize(pasted)).toBe('alpha\n\njust text\n\ndelta\n');
		expect(layout(parse(serialize(pasted)))).toEqual(layout(pasted));
	});
});
