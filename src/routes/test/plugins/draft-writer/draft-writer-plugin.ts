// A plugin whose command writes through `edit()`, the one write a plugin makes: Mod+Shift+Y turns
// the first paragraph reading `write <text>` into `<text>`, for the suites that check that write.
import { definePlugin, registerGlobalCommand } from '#lib/plugin.js';
import { firstDisplayLine } from '#lib/core/lines.js';

const PREFIX = 'write ';

export const draftWriterPlugin = definePlugin({
	name: 'draft-writer',
	setup() {
		registerGlobalCommand(
			'draftWriter.write',
			(editor) => {
				let at = editor.document.prefix.length;
				for (const block of editor.document.children) {
					at += block.leadingTrivia.length;
					const line = firstDisplayLine(block.raw).text;
					if (block.kind === 'paragraph' && line.startsWith(PREFIX)) {
						const draft = editor
							.edit()
							.replace({ from: at, to: at + line.length }, line.slice(PREFIX.length));
						void draft.commit();
						return true;
					}
					at += block.raw.length;
				}
				return false;
			},
			{ chord: 'Mod+Shift+Y' }
		);
	}
});
