/**
 * Idempotent registration of the `:::note` callout: the container kind + the
 * reserved-child-0 `note-title` chrome leaf, plus their components. Safe to
 * import more than once — HMR re-evaluates this module while the registries
 * persist, so each registration guards on the live registry state (via the
 * public idempotence probe) rather than a module-local flag.
 *
 * The title leaf reuses the built-in `TextEditableBlock` directly: because it
 * renders inside the callout's own `BlockList`, every editor context that
 * surface reads (block-edit, focus, sticky-column, …) is already supplied by
 * `createContainerBlock`'s nested-actions wiring — so an editable leaf costs one
 * component import. That single `$lib` dependency is the Fork-A spike's measured
 * input to the eventual `createEditableLeaf` seam.
 */

import {
	registerBlockComponent,
	defineBlockComponent,
	isBlockComponentRegistered,
	type AnyBlockKind
} from '$lib/plugin';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { registerCalloutKind, NOTE, NOTE_TITLE } from './callout-kind';
import CalloutBlock from './CalloutBlock.svelte';

export function registerCallout(): void {
	registerCalloutKind();
	if (!isBlockComponentRegistered(NOTE)) {
		registerBlockComponent(NOTE as AnyBlockKind, defineBlockComponent(CalloutBlock));
	}
	if (!isBlockComponentRegistered(NOTE_TITLE)) {
		registerBlockComponent(
			NOTE_TITLE as AnyBlockKind,
			defineBlockComponent(TextEditableBlock, () => ({ blockClass: 'note-title' }))
		);
	}
}
