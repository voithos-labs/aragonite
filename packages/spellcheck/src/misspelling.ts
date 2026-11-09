/**
 * The misspelled word at a byte, and the one write that replaces it: what the spelling menus run,
 * and what a host drawing its own menu calls with the dictionary it handed the plugin.
 */

import type { Draft, DraftResult, Editor } from '@voithos-labs/aragonite/plugin';
import type { Dictionary } from './dictionary';
import { spanAt, wordSpans, type Misspelling } from './words';

/** The checkable word holding byte `at`, misspelled or not. */
export function wordAt(editor: Pick<Editor, 'blockAt'>, at: number): Misspelling | null {
	const block = editor.blockAt(at);
	return block ? spanAt(wordSpans(block), at) : null;
}

/** The word at byte `at` when `dictionary` says it's misspelled, or null. */
export async function misspellingAt(
	editor: Editor,
	at: number,
	dictionary: Dictionary
): Promise<Misspelling | null> {
	const word = wordAt(editor, at);
	return word && !(await dictionary.check(word.word)) ? word : null;
}

/** Replaces `misspelling` with `word` as one undo step, the caret after it; refused as `moved`
 *  when its bytes now spell something else. */
export function replaceWord(
	editor: Editor,
	misspelling: Misspelling,
	word: string
): Promise<DraftResult> {
	const now = wordAt(editor, misspelling.from);
	if (now?.from !== misspelling.from || now.to !== misspelling.to || now.word !== misspelling.word)
		return Promise.resolve({
			ok: false,
			reason: 'moved',
			message: `'${misspelling.word}' is no longer at ${misspelling.from}`
		});
	return writeWord(editor.edit(), misspelling, word);
}

export function writeWord(
	draft: Draft,
	range: { readonly from: number; readonly to: number },
	word: string
): Promise<DraftResult> {
	const { from, to } = range;
	return draft.replace({ from, to }, word).commit({ caret: from + word.length });
}
