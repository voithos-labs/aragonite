// A plugin whose command writes through `edit()`, the one write a plugin makes: Mod+Shift+Y drops
// the `write ` prefix from the suite's second paragraph, leaving the text after it in place.
import { command, definePlugin } from '#lib/plugin.js';

// The suites seed `Top` and a blank line first, so the prefix sits at these bytes.
const PREFIX = { from: 'Top\n\n'.length, to: 'Top\n\nwrite '.length };

export const draftWriterPlugin = definePlugin({
	name: 'draft-writer',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		commands: [
			command({
				id: 'write',
				title: 'Write the paragraph through a draft',
				chord: 'Mod+Shift+Y',
				run(editor) {
					void editor.edit().replace(PREFIX, '').commit();
				}
			})
		]
	})
});
