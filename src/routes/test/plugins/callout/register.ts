/**
 * Idempotent registration of the `:::note` callout: kind (Task 1) + component
 * (Task 2). Safe to import more than once — HMR re-evaluates this module while
 * the registries persist, so each registration guards on the live registry
 * state (via the public idempotence probe) rather than a module-local flag.
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
