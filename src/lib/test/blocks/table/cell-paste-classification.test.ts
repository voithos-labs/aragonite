// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import {
	__resetPasteSurfacesForTests,
	registerPasteSurface
} from '$lib/tree-operations/paste-surfaces';
import { tableCellPasteSurface } from '$lib/components/blocks/table/table-cell-paste';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { makeEditorActionsDeps, makeStubBlockEdit } from '$lib/test/harness/editor-actions';

// A cell holds text, never blocks, so what a copy wrapped around its text — a blank line at either
// edge — must not decide the route: those blocks used to be trivia, and reading them as content
// sent an ordinary text paste down the break-the-table path.

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

/** Paste into the body row's first cell, path [0, 1, 0]. */
async function pasteIntoCell(clipboard: string) {
	const { deps } = makeEditorActionsDeps(parse(TABLE).children);
	const blockEdit = makeStubBlockEdit();

	await pasteDispatch(
		{ pastedText: clipboard, targetPath: [0, 1, 0], offset: 0 },
		{
			doc: deps.doc,
			blockEdit,
			controller: createPasteCoordinator(createUndoController(deps), deps.revealPath),
			undoEntry: 'own'
		}
	);
	return {
		doc: deps.doc,
		updateBlockContent: blockEdit.updateBlockContent as ReturnType<typeof vi.fn>
	};
}

describe('a clipboard pasted into a table cell', () => {
	beforeEach(() => {
		__resetPasteSurfacesForTests();
		registerPasteSurface(tableCellPasteSurface);
	});

	it('flattens text wrapped in blank lines into the cell', async () => {
		const { doc, updateBlockContent } = await pasteIntoCell('  \nhello\nworld\n  ');

		expect(updateBlockContent).toHaveBeenCalledWith(0, 'hello world1', expect.any(Number));
		expect(doc.children.map((c) => c.kind)).toEqual(['table']);
	});

	it('still breaks the table for two content blocks', async () => {
		const { updateBlockContent } = await pasteIntoCell('a\n\nb\n');

		expect(updateBlockContent).not.toHaveBeenCalled();
	});

	it('still breaks the table for a single non-paragraph block', async () => {
		const { updateBlockContent } = await pasteIntoCell('  \n# Hello\n  ');

		expect(updateBlockContent).not.toHaveBeenCalled();
	});
});
