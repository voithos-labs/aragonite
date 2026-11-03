import { definePlugin, type EditorPlugin } from '@voithos-labs/aragonite/plugin';
import { registerEmoji } from './emoji-recognizer';

export function emojiPlugin(): EditorPlugin {
	return definePlugin({
		name: 'emoji',
		setup() {
			registerEmoji();
		}
	});
}
