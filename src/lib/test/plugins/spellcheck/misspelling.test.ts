// @vitest-environment jsdom
// The host's two operations over the document: the misspelled word at a byte, and the one write
// that replaces it.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { misspellingAt, replaceWord } from '#packages/spellcheck/src/index.js';
import type { Dictionary } from '#packages/spellcheck/src/dictionary.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import { readingEditor } from './reading-editor';

beforeAll(() => installLayoutStubs());
afterEach(() => destroyMountedEditors());

const dictionary: Dictionary = {
	check: async (word) => word !== 'teh',
	suggest: () => ['the']
};

// Ten bytes ahead of the line, so `teh` sits at 14.
const DOC = 'Prologue\n\nsay teh cat\n';
const TEH = { word: 'teh', from: 14, to: 17 };

describe('misspellingAt', () => {
	it('names the misspelled word holding a byte, and nothing over a word spelled right', async () => {
		const { editor } = await readingEditor(DOC);
		expect(await misspellingAt(editor, 15, dictionary)).toEqual(TEH);
		expect(await misspellingAt(editor, 11, dictionary)).toBeNull();
		expect(await misspellingAt(editor, 2, dictionary)).toBeNull();
	});
});

describe('replaceWord', () => {
	it('writes the new word over the old as one commit', async () => {
		const { editor, m } = await readingEditor(DOC);
		expect(await replaceWord(editor, TEH, 'the')).toEqual({ ok: true });
		expect(m.source()).toBe('Prologue\n\nsay the cat\n');
	});

	// Miss-analysis: the PR's replace spliced the saved offsets, and no test replaced a word after an
	// edit had moved it.
	it('refuses as moved once the word is no longer at its bytes, writing nothing', async () => {
		const { editor, m } = await readingEditor(DOC);
		await editor.edit().replace({ from: 10, to: 10 }, 'the extra ').commit();
		const moved = m.source();
		expect(await replaceWord(editor, TEH, 'the')).toMatchObject({ ok: false, reason: 'moved' });
		expect(m.source()).toBe(moved);
	});
});
