/**
 * The plugin unit installs this setup once per process, so the registration runs
 * unguarded and re-registers cleanly after a schema reset.
 */

import { definePlugin, registerInsertEntry, type EditorPlugin } from '#lib/plugin.js';
import { svelteBlockView } from '#lib/svelte.js';
import { registerDetailsKind } from './details-kind';
import DetailsBlock from './DetailsBlock.svelte';

export function detailsPlugin(): EditorPlugin {
	return definePlugin({
		name: 'details',
		setup() {
			registerDetailsKind(svelteBlockView(DetailsBlock));
			registerInsertEntry({
				id: 'details',
				label: 'Details',
				icon: 'list-collapse',
				keywords: ['toggle', 'collapsible', 'disclosure', 'summary', 'expand'],
				markdown: '<details>\n<summary></summary>\n\n</details>\n'
			});
		}
	});
}
