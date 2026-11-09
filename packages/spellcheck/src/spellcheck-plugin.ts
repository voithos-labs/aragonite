/** The spell check as a plugin value: list it in an editor's `plugins`. */

import { definePlugin, type Editor } from '@voithos-labs/aragonite/plugin';
import type { Dictionary } from './dictionary';
import { englishDictionary, type EnglishDictionaryOptions } from './english/english-dictionary';
import { spellingAction } from './spelling-action';
import { createTypingWord, followTyping } from './typing-word';
import { createVerdicts } from './verdicts';
import { paintWaves } from './waves';
import './spellcheck.css';

export interface SpellcheckOptions extends EnglishDictionaryOptions {
	/** The dictionary to ask. Absent, each editor makes its own English one from `words` and
	 *  `onAddWord`; pass one to share it between editors, or to reach it from your own menu. */
	dictionary?: Dictionary;
}

export const spellcheckPlugin = definePlugin<SpellcheckOptions>({
	name: 'spellcheck',
	version: '0.11.5',
	editor: '0.11.5',
	contributes(options) {
		const { words, onAddWord } = options;
		const typing = createTypingWord();
		// Set in the same mount pass as the first paint, before any answer can come back.
		let editor: Editor | null = null;
		const verdicts = createVerdicts({
			dictionary: options.dictionary ?? englishDictionary({ words, onAddWord }),
			changed: () => editor?.repaint(),
			onError: (error) => (globalThis.reportError ?? console.error)(error)
		});
		return {
			checksSpelling: true,
			actions: [spellingAction(verdicts)],
			paint: (block) => paintWaves(block, verdicts, typing),
			setup(mounted) {
				editor = mounted;
				followTyping(mounted, typing);
				return () => {
					editor = null;
					verdicts.dispose();
				};
			}
		};
	}
});
