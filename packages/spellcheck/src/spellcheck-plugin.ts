/** The spell check as a plugin value: list it in an editor's `plugins`. */

import { definePlugin } from '@voithos-labs/aragonite/plugin';

export const spellcheckPlugin = definePlugin({
	name: 'spellcheck',
	version: '0.11.5',
	editor: '0.11.5',
	contributes: () => ({})
});
