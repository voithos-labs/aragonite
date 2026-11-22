// A comment anchor as a marker pair: `{>>id}` opens it, `{<<id}` closes it, in one block or in two.
// Both sides draw nothing in live mode; the id pairs them, for the plugin and for a removal.
import { definePlugin, markerPair } from '#lib/plugin.js';

export const anchor = markerPair({
	name: 'anchor',
	label: 'Comment anchor',
	open: { prefix: '{>>', match: /\{>>([\w-]+)\}/, read: (m) => ({ id: m[1] }) },
	close: { prefix: '{<<', match: /\{<<([\w-]+)\}/, read: (m) => ({ id: m[1] }) },
	key: ({ id }) => id,
	sample: 'A {>>a}noted{<<a} word'
});

export const anchorPlugin = definePlugin({
	name: 'comment-anchor',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ inlines: [anchor] })
});
