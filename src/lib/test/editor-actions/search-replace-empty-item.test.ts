import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createSearchReplace } from '#lib/editor-actions/search-replace.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { describeShapeDivergence } from '#lib/core/shape-divergence.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { initDocument } from '#lib/components/editor-root/document-swap.js';

// A replace that empties an item or a quote leaves bytes that reload as the container still shown:
// under a paragraph the list takes a blank line above it, or a bare marker reads as a setext
// underline, and at the document's end the container keeps the paragraph you type into.
// Miss-analysis (GH #438): no replace test emptied a first item under a paragraph.
// Miss-analysis (GH #685): the replace re-read its block without the editor's empty paragraph.

describe('a replace that empties the first item under a paragraph', () => {
	it.each([
		['a list', 'para\n- x\n', [1, 0, 0], 'para\n\n- \n'],
		['a list with more items', 'para\n- x\n- z\n', [1, 0, 0], 'para\n\n- \n- z\n'],
		['a list in a quote', '> para\n> - x\n', [0, 1, 0, 0], '> para\n>\n> - \n']
	])('in %s keeps the paragraph and the list', async (_, source, path, after) => {
		const { deps } = makeEditorActionsDeps(parse(source));
		const sr = createSearchReplace(deps, createUndoController(deps));

		await sr.replaceOne({ path, start: 0, end: 1 }, '');

		expect(serialize(deps.doc)).toBe(after);
		expect(JSON.stringify(deps.doc.children)).not.toContain('setextHeading');
		expect(describeConvergence(deps.doc)).toBeNull();
	});
});

describe('a replace that empties the last container at the end of the document', () => {
	it.each([
		['an item', '- x', [0, 0, 0], '- \n'],
		['a quote', '> x', [0, 0], '>\n']
	])('keeps %s a reload reads the same', async (_, source, path, after) => {
		const { deps } = makeEditorActionsDeps(initDocument(source, defaultGrammarView).doc);
		const sr = createSearchReplace(deps, createUndoController(deps));

		await sr.replaceOne({ path, start: 0, end: 1 }, '');

		const reload = initDocument(serialize(deps.doc), defaultGrammarView).doc;
		expect(describeShapeDivergence(deps.doc, reload)).toBeNull();
		expect(serialize(deps.doc)).toBe(after);
	});
});
