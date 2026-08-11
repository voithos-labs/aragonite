/**
 * The public activation entry for the `:::name` directive primitive, on the `aragonite/plugin`
 * barrel: grammar plus the generic container and leaf render. A pure-GFM consumer that never calls
 * it leaves `:::` unclaimed. Lives in `components/` because it binds Svelte components, which core
 * must not reach. Every registration guards its public probe, so repeat calls are safe.
 */

import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import {
	registerBlockComponent,
	defineBlockComponent,
	isBlockComponentRegistered
} from '$lib/schema/block-component-registry';
import { declaredPluginKind } from '$lib/schema/plugin-kind';
import { DIRECTIVE_CONTAINER, DIRECTIVE_LEAF } from '$lib/core/directive/kinds';
import DirectiveContainerBlock from './DirectiveContainerBlock.svelte';
import TextEditableBlock from '../text/TextEditableBlock.svelte';

export function activateDirectives(): void {
	activateDirectiveGrammar();

	if (!isBlockComponentRegistered(DIRECTIVE_CONTAINER)) {
		registerBlockComponent(
			declaredPluginKind(DIRECTIVE_CONTAINER),
			defineBlockComponent(DirectiveContainerBlock)
		);
	}

	// The leaf's descriptor already drives its dimmed marker and split behavior, so it
	// reuses the built-in text surface directly.
	if (!isBlockComponentRegistered(DIRECTIVE_LEAF)) {
		registerBlockComponent(
			declaredPluginKind(DIRECTIVE_LEAF),
			defineBlockComponent(TextEditableBlock, () => ({ blockClass: 'directive-leaf' }))
		);
	}
}
