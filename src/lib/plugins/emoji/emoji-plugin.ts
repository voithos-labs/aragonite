import { definePlugin, type EditorPlugin } from '$lib/plugin';
import { registerEmoji } from './emoji-recognizer';

export function emojiPlugin(): EditorPlugin {
	return definePlugin({
		name: 'emoji',
		setup() {
			registerEmoji();
		}
	});
}
