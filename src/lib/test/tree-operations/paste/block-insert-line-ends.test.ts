// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { tableCellPasteSurface } from '$lib/components/blocks/table/table-cell-paste';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import {
	makeEditorActionsDeps,
	makeStubBlockEdit,
	pasteContext
} from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { ensurePasteSurface } from '$lib/test/support/paste-surface';

// A block pasted or inserted with no line ending of its own took the next block's blank line as
// its ending, and a block landed after a table's cell had no blank line before or after it, so
// the reload read other blocks than the editor held (GH #415).
// Miss-analysis: every structural paste pin ended its clipboard in a line ending, and no pin
// landed blocks from a cell with a block or a table half after them.

const TABLE = '| a | b |\n| --- | --- |\n| c |  |\n';

beforeEach(() => {
	__resetSchemaRegistriesForTests();
	ensurePasteSurface(tableCellPasteSurface);
});

async function insert(source: string, targetPath: number[], offset: number, markdown: string) {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	await pasteDispatch(
		{ pastedText: markdown, targetPath, offset },
		pasteContext({
			doc: deps.doc,
			blockEdit: makeStubBlockEdit(),
			controller: createPasteCoordinator(createUndoController(deps), deps.revealPath),
			undoEntry: 'own'
		})
	);
	return deps.doc;
}

describe('blocks inserted from a table cell', () => {
	it.each([
		['an empty quote', '> ', `${TABLE}\n> \n\nAfter\n`],
		['a quote with text', '> quoted\n', `${TABLE}\n> quoted\n\nAfter\n`],
		['a list with no line ending', '- x', `${TABLE}\n- x\n\nAfter\n`]
	])('%s reloads as one block before the paragraph', async (_, markdown, after) => {
		const doc = await insert(`${TABLE}\nAfter\n`, [0, 1, 1], 0, markdown);

		expect(serialize(doc)).toBe(after);
		expect(describeConvergence(doc)).toBeNull();
	});

	it('leaves the rows below the cell a table of their own', async () => {
		const doc = await insert(`${TABLE}| d | e |\n`, [0, 1, 1], 0, 'x\n\ny');

		expect(doc.children.map((c) => c.kind)).toEqual(['table', 'paragraph', 'paragraph', 'table']);
		expect(describeConvergence(doc)).toBeNull();
	});
});

describe('a clipboard block with no line ending pasted into a paragraph', () => {
	it('keeps the blank line before the next block', async () => {
		const doc = await insert('abc\n\nAfter\n', [0], 3, '> q');

		expect(serialize(doc)).toBe('abc\n\n> q\n\nAfter\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'blockquote', 'paragraph']);
	});
});
