/**
 * Two block kinds from one setup, so this wires `definePlugin` directly rather than
 * the single-kind `definePluginBlock` sugar.
 */

import { definePlugin, type EditorPlugin } from '$lib/plugin';
import { registerAdmonitions, type AdmonitionsOptions } from './admonition-kind';

export function admonitionsPlugin(options?: AdmonitionsOptions): EditorPlugin {
	return definePlugin({
		name: 'admonitions',
		setup: () => registerAdmonitions(options)
	});
}
