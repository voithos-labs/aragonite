// @vitest-environment jsdom
// G1.220 is asked where a fold is made: a letter that dissolves an admonition hands the check the
// list's bytes from before the fold and from after it. With either missing the check says nothing.
// Miss-analysis: the predicate's rows and the scan both pass while the call hands it no bytes.
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { checkFoldKeepsLines } from '#lib/invariants/fold-keeps-lines.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { insertBy } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { SYNTAX_PLUGINS } from '#lib/test/behavior/corpus.js';

vi.mock('#lib/invariants/fold-keeps-lines.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/invariants/fold-keeps-lines.js')>();
	return { ...actual, checkFoldKeepsLines: vi.fn(actual.checkFoldKeepsLines) };
});

beforeAll(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

it('reads the list before and after the fold a dissolved container makes', async () => {
	const editor = mountEditor({ source: 'x\n:::tip\nner\n:::\n\n# h\n', plugins: SYNTAX_PLUGINS });
	await editor.settle();
	const row = surfaceAt(editor, [1, 0]);
	placeCaret(row, 0);

	await insertBy('hardware key', row, 'q');
	await editor.settle();

	expect(vi.mocked(checkFoldKeepsLines).mock.calls).toEqual([
		['x\nq:::tip\nner\n:::\n\n# h\n', 'x\nq:::tip\nner\n:::\n\n# h\n']
	]);
	expect(takeDevWarns()).toEqual([]);
});
