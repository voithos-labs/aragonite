/**
 * The callout plugin: the `:::callout` container model plus its component. The plugin unit
 * installs this setup once per process, so it runs unguarded and survives a schema reset.
 */

import { definePluginBlock, type EditorPlugin } from '$lib/plugin';
import { registerCalloutKind, CALLOUT } from './callout-kind';
import CalloutBlock from './CalloutBlock.svelte';

export function calloutPlugin(): EditorPlugin {
	return definePluginBlock({
		name: 'callout',
		kind: CALLOUT,
		component: CalloutBlock,
		register: registerCalloutKind
	});
}
