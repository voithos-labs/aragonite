import { definePlugin, type EditorPlugin } from '#lib/plugin.js';
import { registerEmoji } from './emoji-recognizer';

export function emojiPlugin(): EditorPlugin {
	return definePlugin({
		name: 'emoji',
		setup() {
			registerEmoji();
		}
	});
}
