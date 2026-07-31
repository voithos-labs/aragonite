/**
 * The plugin unit installs this setup once per process, so the registration runs
 * unguarded and re-registers cleanly after a schema reset.
 */

import { definePluginBlock, type EditorPlugin } from '$lib/plugin';
import { registerDetailsKind, DETAILS } from './details-kind';
import DetailsBlock from './DetailsBlock.svelte';

export function detailsPlugin(): EditorPlugin {
	return definePluginBlock({
		name: 'details',
		kind: DETAILS,
		component: DetailsBlock,
		register: registerDetailsKind
	});
}
