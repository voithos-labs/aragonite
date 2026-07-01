/**
 * Idempotent registration of the `:::note` callout: kind (Task 1) + component
 * (Task 2 spike). Safe to import more than once — HMR re-evaluates this module
 * while the `$lib` registries persist, so each registration guards on the live
 * registry state rather than a module-local flag.
 *
 * `getBlockComponent` is reached from `$lib` internals only to answer "is the
 * component already registered?" — `registerBlockComponent` throws on duplicate
 * and the public surface exposes no such probe. That gap is a spike finding.
 */

import { registerBlockComponent, defineBlockComponent, type AnyBlockKind } from '$lib/plugin';
import { getBlockComponent } from '$lib/schema/block-component-registry';
import { registerCalloutKind, NOTE } from './callout-kind';
import CalloutBlock from './CalloutBlock.svelte';

export function registerCallout(): void {
	registerCalloutKind();
	if (!getBlockComponent(NOTE as AnyBlockKind)) {
		registerBlockComponent(NOTE as AnyBlockKind, defineBlockComponent(CalloutBlock));
	}
}
