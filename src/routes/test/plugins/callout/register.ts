/**
 * The callout plugin: the `:::note` container model (kind + `note-title` chrome
 * leaf, registered by `registerCalloutKind`) plus the container component. The
 * plugin unit installs this setup once per process, so it runs unguarded and
 * re-registers cleanly after a schema reset.
 */

import { definePluginBlock, type EditorPlugin } from '$lib/plugin';
import { registerCalloutKind, NOTE } from './callout-kind';
import CalloutBlock from './CalloutBlock.svelte';

export function calloutPlugin(): EditorPlugin {
	return definePluginBlock({
		name: 'callout',
		kind: NOTE,
		component: CalloutBlock,
		register: registerCalloutKind
	});
}
