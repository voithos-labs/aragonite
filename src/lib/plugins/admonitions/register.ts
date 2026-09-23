/**
 * Two block kinds from one setup, so this wires `definePlugin` directly rather than
 * the single-kind `definePluginBlock` sugar.
 */

import { definePlugin, registerInsertEntry, type EditorPlugin } from '$lib/plugin';
import { registerAdmonitions, type AdmonitionsOptions } from './admonition-kind';

export function admonitionsPlugin(options?: AdmonitionsOptions): EditorPlugin {
	return definePlugin({
		name: 'admonitions',
		setup() {
			registerAdmonitions(options);
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
