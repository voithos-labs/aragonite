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
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import { splitNode } from '$lib/tree-operations/node-ops';
import { makeEditorActionsDeps, makeStubBlockEdit } from '$lib/test/harness/editor-actions';
import { triviaRawOf } from '$lib/test/harness/parse-converged';

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
	return (await pasteLive(doc, [index], 0, clipboard)).doc;
}

/**
 * Paste through the real per-level bundle, so the INLINE route commits too — `makeStubBlockEdit`
 * swallows `updateBlockContent`, which is every single-paragraph clipboard.
 */
async function pasteLive(
	doc: Document,
	targetPath: number[],
	offset: number,
	clipboard: string
): Promise<{ doc: Document; history: ReturnType<typeof createHistoryActions> }> {
	__resetPasteSurfacesForTests();
	registerPasteSurface(__getDefaultTextSurface('paragraph'));
	registerPasteSurface(__getDefaultTextSurface('heading'));
	// The whole document, not its children: the trailing slot is the subject here.
	const { deps } = makeEditorActionsDeps(doc);
	const controller = createUndoController(deps);

	await pasteDispatch(
		{ pastedText: clipboard, targetPath, offset },
		{
			doc: deps.doc,
			blockEdit: createBlockEditActions(deps, controller),
			controller: createPasteCoordinator(controller, deps.revealPath),
			undoEntry: 'own'
		}
	);
	return { doc: deps.doc, history: createHistoryActions(deps, controller) };
}

const raws = (doc: Document): string[] => doc.children.map((n) => n.raw);

const layout = (doc: Document) => triviaRawOf(doc.children);

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
		splitNode(split, 0, 5, undefined, undefined, undefined);
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

// GH #131: the parse folds a clipboard's ONE trailing blank into `doc.suffix` (a second already
// materializes as a block), and the structural route consumed children only — so the same copied
// separation survived an inline paste and vanished on a structural one.
// Miss-analysis: every parity case pasted a clipboard whose bytes ended in content or in a run
// long enough to materialize, so the single-line suffix was the one shape none of them carried.
describe('a clipboard’s trailing blank line is content', () => {
	it('keeps it at the document tail, where nothing else stands for the separation', async () => {
		const { doc } = await pasteLive(parse('x\n'), [0], 1, '# h\n\n');

		expect(serialize(doc)).toBe('x\n\n# h\n\n');
		expect(doc.suffix).toBe('\n');
		expect(layout(parse(serialize(doc)))).toEqual(layout(doc));
	});

	// The route that never lost it: the same bytes through the inline splice, which is what makes
	// the structural arm's answer a parity fix rather than a new opinion.
	it('keeps it on the inline route too', async () => {
		const { doc } = await pasteLive(parse('x\n'), [0], 1, 'one\n\n');

		expect(serialize(doc)).toBe('xone\n\n\n');
	});

	// Settled away: the splice already separates the pasted blocks from what follows, so the
	// clipboard's line would be a second blank nobody typed.
	it.each([
		['a follower below the splice', [0] as number[], 5, 'alpha\n\n# h\n\ndelta\n'],
		['a follower it was pasted in front of', [1] as number[], 0, 'alpha\n\n# h\n\ndelta\n'],
		['reattached residue', [1] as number[], 2, 'alpha\n\nde\n\n# h\n\nlta\n']
	])('drops it where the splice leaves %s', async (_case, path, offset, expected) => {
		const { doc } = await pasteLive(parse('alpha\n\ndelta\n'), path, offset, '# h\n\n');

		expect(serialize(doc)).toBe(expected);
		expect(doc.suffix).toBe('');
	});

	// The slot's own bytes win where it already holds a line: a clipboard is normalized to LF at
	// every entry point, so overwriting would strand one in a CRLF document (G4.20).
	it('leaves a tail that already ends in a blank alone', async () => {
		const { doc } = await pasteLive(parse('x\r\n\r\n'), [0], 1, '# h\n\n');

		expect(doc.suffix).toBe('\r\n');
	});

	// The slot's own bytes are not the only CRLF question: an EMPTY slot mints one, and a
	// clipboard normalized to LF at every entry point cannot answer for its flavor (G4.20).
	// Miss-analysis: the CRLF-mirror oracle's gestures drew no paste at the document tail, and
	// G4.20's shape scans see literal newlines only, which a data-derived suffix never is.
	it('mints the tail separator in a CRLF document’s own ending', async () => {
		const { doc } = await pasteLive(parse('x\r\n'), [0], 1, '# h\n\n');

		expect(doc.suffix).toBe('\r\n');
		// Byte round-trip, not `layout`: the suffix is the subject and layout does not carry it.
		expect(serialize(parse(serialize(doc)))).toBe(serialize(doc));
	});

	it('gives the suffix back on undo', async () => {
		const { doc, history } = await pasteLive(parse('x\n'), [0], 1, '# h\n\n');
		expect(doc.suffix).toBe('\n');

		await history.requestUndo();

		expect(serialize(doc)).toBe('x\n');
		expect(doc.suffix).toBe('');
	});
});
