/**
 * GitHub `:shortcode:` emoji as a first-party plugin. Installing it teaches the
 * editor to recognize gemoji shortcodes on the bare `:` trigger and render each as
 * an atomic glyph widget; importing the module is inert.
 */

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
