/** The admonitions plugin: the `:::note` directive container and native GitHub alerts, both drawn
 *  by one component. */

import {
	definePlugin,
	registerInsertEntry,
	type EditorPlugin
} from '@voithos-labs/aragonite/plugin';
import { svelteBlockView } from '@voithos-labs/aragonite/svelte';
import { registerAdmonitions, type AdmonitionsOptions } from './admonition-kind';
import AdmonitionBlock from './AdmonitionBlock.svelte';

export function admonitionsPlugin(options?: AdmonitionsOptions): EditorPlugin {
	return definePlugin({
		name: 'admonitions',
		setup() {
			registerAdmonitions(svelteBlockView(AdmonitionBlock), options);
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
