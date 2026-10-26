// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { tableCellPasteSurface } from '#lib/components/blocks/table/table-cell-paste.js';
import {
	makeStubBlockEdit,
	runPasteDispatch,
	makePasteCommit
} from '#lib/test/harness/editor-actions.js';
import { ensurePasteSurface } from '#lib/test/support/paste-surface.js';

// A cell holds text, never blocks, so blank lines a copy wrapped around the text must not decide
// the route: read as content, they send a plain text paste down the path that breaks the table.

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

/** Paste into the body row's first cell, path [0, 1, 0]. */
async function pasteIntoCell(clipboard: string) {
	const h = makePasteCommit(parse(TABLE).children);
	const blockEdit = makeStubBlockEdit();

	await runPasteDispatch(
		h,
		{ pastedText: clipboard, targetPath: [0, 1, 0], offset: 0 },
		{ blockEdit }
	);
	return {
		doc: h.doc,
		updateBlockContent: blockEdit.updateBlockContent as ReturnType<typeof vi.fn>
	};
}

describe('a clipboard pasted into a table cell', () => {
	beforeEach(() => {
		ensurePasteSurface(tableCellPasteSurface);
	});

	it('flattens text wrapped in blank lines into the cell', async () => {
		const { doc, updateBlockContent } = await pasteIntoCell('  \nhello\nworld\n  ');

		expect(updateBlockContent).toHaveBeenCalledWith(
			0,
			'hello world1',
			'literal',
			'join-typing',
			expect.any(Number),
			expect.any(Number)
		);
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
