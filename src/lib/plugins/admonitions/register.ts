/**
 * The admonitions plugin: the five `:::name` directive kinds (`:::note` …
 * `:::caution`, registered by `registerAdmonitions`) plus the `AdmonitionBlock`
 * component. The plugin unit installs this setup once per process.
 */

import { definePluginBlock, type EditorPlugin } from '$lib/plugin';
import { registerAdmonitions } from './admonition-kind';
import { ADMONITION } from './kinds';
import AdmonitionBlock from './AdmonitionBlock.svelte';

export function admonitionsPlugin(): EditorPlugin {
	return definePluginBlock({
		name: 'admonitions',
		kind: ADMONITION,
		component: AdmonitionBlock,
		register: registerAdmonitions
	});
}
