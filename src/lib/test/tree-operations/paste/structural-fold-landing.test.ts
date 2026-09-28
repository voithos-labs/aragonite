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

// The fix-up can merge pasted blocks into neighbours, so the caret follows bytes, not an index.
// Miss-analysis: the structural-paste caret tests checked the block index, never the offset in it.

async function pasteAt(source: string, pastedText: string, targetPath: number[], offset: number) {
	const { deps, landings } = makeEditorActionsDeps(parse(source));
	const coordinator = createPasteCoordinator(deps, createUndoController(deps));

	await pasteDispatch(
		{ pastedText, targetPath, offset },
		pasteContext({
			doc: deps.doc,
			blockEdit: makeStubBlockEdit(),
			controller: coordinator
		})
	);
	return { doc: deps.doc, landings };
}

describe('structural paste landing after the splice settle folds', () => {
	it('lands where the pasted bytes end inside the leaf that absorbed the residue', async () => {
		const { doc, landings } = await pasteAt('helloworld\n', 'one\n\ntwo', [0], 5);

		expect(serialize(doc)).toBe('hello\n\none\n\ntwo\nworld\n');
		expect(landings).toMatchObject([{ leafPath: [2], offset: 'two'.length }]);
	});

	it('follows the slot down when the block above absorbs the pasted window', async () => {
		const { doc, landings } = await pasteAt('- a\n\nzz\n', '  b\n\nmore', [1], 0);

		expect(serialize(doc)).toBe('- a\n\n  b\n\nmore\nzz\n');
		expect(doc.children).toHaveLength(2);
		expect(landings).toMatchObject([{ leafPath: [1], offset: 'more'.length }]);
	});

	it('lands the same caret position when nothing folds', async () => {
		const { doc, landings } = await pasteAt('helloworld\n', 'one\n\ntwo\n\n', [0], 5);

		expect(serialize(doc)).toBe('hello\n\none\n\ntwo\n\nworld\n');
		expect(landings).toMatchObject([{ leafPath: [2], offset: 'two'.length }]);
	});

	// The merged head is a container here, so the pasted bytes end inside one of its leaves.
	it('lands inside the container leaf that absorbed the residue', async () => {
		const { doc, landings } = await pasteAt('helloworld\n', '- item', [0], 5);

		expect(serialize(doc)).toBe('hello\n\n- item\nworld\n');
		expect(landings).toMatchObject([{ leafPath: [1, 0, 0], offset: 'item'.length }]);
	});

	// The quote takes the line after the caret in lazily.
	it('lands after the pasted quote text, not after the line it absorbed', async () => {
		const { doc, landings } = await pasteAt('abc\nAfter\n', '> q', [0], 3);

		expect(serialize(doc)).toBe('abc\n\n> q\nAfter\n');
		expect(landings).toMatchObject([{ leafPath: [1, 0], offset: 'q'.length }]);
	});

	it('descends through nested containers', async () => {
		const { doc, landings } = await pasteAt('helloworld\n', '> - item', [0], 5);

		expect(serialize(doc)).toBe('hello\n\n> - item\nworld\n');
		expect(landings).toMatchObject([{ leafPath: [1, 0, 0, 0], offset: 'item'.length }]);
	});
});
