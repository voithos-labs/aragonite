/**
 * Idempotent registration of the `:::note` callout: the container kind + its
 * component. Safe to import more than once — HMR re-evaluates this module while
 * the registries persist, so each registration guards on the live registry state
 * (via the public idempotence probe) rather than a module-local flag.
 *
 * The reserved-child-0 `note-title` chrome leaf (kind + descriptor + component)
 * is registered by `registerCalloutKind` via `registerChromeLeaf`, so this file
 * only wires the container component.
 */

import {
	registerBlockComponent,
	defineBlockComponent,
	isBlockComponentRegistered,
	type AnyBlockKind
} from '$lib/plugin';
import { registerCalloutKind, NOTE } from './callout-kind';
import CalloutBlock from './CalloutBlock.svelte';

export function registerCallout(): void {
	registerCalloutKind();
	if (!isBlockComponentRegistered(NOTE)) {
		registerBlockComponent(NOTE as AnyBlockKind, defineBlockComponent(CalloutBlock));
	}
}
