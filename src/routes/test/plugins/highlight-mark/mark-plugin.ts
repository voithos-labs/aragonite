// `==text==` as a plugin mark: hidden runs in live mode, a chord that toggles it, and Enter that
// closes and reopens it, as `**` does.
import { definePlugin, mark } from '#lib/plugin.js';

export const highlight = mark({
	name: 'highlight',
	label: 'Highlight',
	marker: '==',
	chord: 'Mod+Shift+h',
	tag: 'mark',
	class: 'harness-highlight',
	sample: '==hi=='
});

export const highlightPlugin = definePlugin({
	name: 'highlight-mark',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ inlines: [highlight] })
});
