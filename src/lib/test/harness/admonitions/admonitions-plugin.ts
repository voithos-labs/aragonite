/** The admonitions package's old `setup` plugin: the `:::note` directive container and native
 *  GitHub alerts, both drawn by one component. */

import { definePlugin, registerInsertEntry, type EditorPlugin } from '#lib/plugin.js';
import { svelteBlockView } from '#lib/svelte.js';
import { registerAdmonitions } from './admonition-kind';
import AdmonitionBlock from './AdmonitionBlock.svelte';

export function admonitionsPlugin(): EditorPlugin {
	return definePlugin({
		name: 'admonitions',
		setup() {
			registerAdmonitions(svelteBlockView(AdmonitionBlock));
			registerInsertEntry({
				id: 'note',
				label: 'Note',
				icon: 'info',
				keywords: ['note', 'admonition', 'callout'],
				markdown: ':::note\n\n:::\n'
			});
		}
	});
}
