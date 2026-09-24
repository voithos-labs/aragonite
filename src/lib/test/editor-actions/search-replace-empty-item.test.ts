import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createSearchReplace } from '$lib/editor-actions/search-replace';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// A list whose first item is emptied right under a paragraph needs a blank line above it: a bare
// marker cannot interrupt a paragraph, so the bytes would reload as a setext heading (GH #438).
// Typing already settles that line; a replace that empties the item must too.
// Miss-analysis: the replace pins asserted bytes and events, none emptied a first item under a
// paragraph, and convergence passed because the fold read the heading the bytes spelled.

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
