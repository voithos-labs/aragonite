// The host's two operations over the document: the misspelled word at a byte, and the one write
// that replaces it.
import { describe, expect, it, vi } from 'vitest';
import type { Draft } from '#lib/plugin.js';
import { misspellingAt, replaceWord } from '#packages/spellcheck/src/index.js';
import type { Dictionary } from '#packages/spellcheck/src/dictionary.js';
import { readingEditor, textBlock } from './text-block';

const dictionary: Dictionary = {
	check: async (word) => word !== 'teh',
	suggest: () => ['the']
};

function draftRecorder() {
	const writes: unknown[] = [];
	const draft = {
		replace: (range: unknown, text: string) => (writes.push({ range, text }), draft),
		commit: async (options: unknown) => (writes.push({ commit: options }), { ok: true as const })
	};
	return { writes, edit: vi.fn(() => draft as unknown as Draft) };
}

describe('misspellingAt', () => {
	const editor = readingEditor([textBlock('say teh cat', 10)]);

	it('names the misspelled word holding a byte, and nothing over a word spelled right', async () => {
		expect(await misspellingAt(editor, 15, dictionary)).toEqual({ word: 'teh', from: 14, to: 17 });
		expect(await misspellingAt(editor, 11, dictionary)).toBeNull();
		expect(await misspellingAt(editor, 2, dictionary)).toBeNull();
	});
});

describe('replaceWord', () => {
	it('writes the new word over the old as one commit, the caret after it', async () => {
		const { writes, edit } = draftRecorder();
		const editor = readingEditor([textBlock('say teh cat', 10)], edit);
		const result = await replaceWord(editor, { word: 'teh', from: 14, to: 17 }, 'the');
		expect(result).toEqual({ ok: true });
		expect(writes).toEqual([
			{ range: { from: 14, to: 17 }, text: 'the' },
			{ commit: { caret: 17 } }
		]);
	});

	// Miss-analysis: the PR's replace spliced the saved offsets, and no test replaced a word after an
	// edit had moved it.
	it('refuses as moved once the word is no longer at its bytes, writing nothing', async () => {
		const { writes, edit } = draftRecorder();
		const editor = readingEditor([textBlock('the extra teh cat', 10)], edit);
		const result = await replaceWord(editor, { word: 'teh', from: 14, to: 17 }, 'the');
		expect(result).toMatchObject({ ok: false, reason: 'moved' });
		expect(edit).not.toHaveBeenCalled();
		expect(writes).toEqual([]);
	});
});
