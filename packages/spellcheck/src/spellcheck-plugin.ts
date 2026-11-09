/** The spell check as a plugin value: list it in an editor's `plugins`. */

import { definePlugin } from '@voithos-labs/aragonite/plugin';
import type { Dictionary } from './dictionary';
import { englishDictionary, type EnglishDictionaryOptions } from './english/english-dictionary';
import { spellingAction } from './spelling-action';
import { createVerdicts } from './verdicts';

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
		const verdicts = createVerdicts({
			dictionary: options.dictionary ?? englishDictionary({ words, onAddWord }),
			changed: () => {},
			onError: (error) => (globalThis.reportError ?? console.error)(error)
		});
		return { actions: [spellingAction(verdicts)] };
	}
});
