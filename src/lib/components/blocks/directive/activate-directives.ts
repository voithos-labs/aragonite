/**
 * The public activation entry for the `:::name` directive primitive —
 * `activateDirectives()` on the `aragonite/plugin` barrel. It turns the whole
 * feature on: the grammar (kinds + openers + inline `:` recognizer, via
 * `activateDirectiveGrammar`) plus the generic container and single-line leaf
 * render. A consumer calls it once at startup; a pure-GFM consumer that never
 * calls it leaves `:::` unclaimed.
 *
 * Lives in `components/` because it binds Svelte components — core must not reach
 * the component tree. Every registration guards its public probe, so the callout
 * dogfood, the route, and HMR re-runs can all call it safely.
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

	// The leaf is a single editable line whose descriptor (getContentRange + keymap)
	// drives the dimmed `::name` marker and the paragraph-split / not-mergeable
	// behavior, so it reuses the built-in text surface directly — the `directive-leaf`
	// class is the render/e2e handle, not a card box.
	if (!isBlockComponentRegistered(DIRECTIVE_LEAF)) {
		registerBlockComponent(
			declaredPluginKind(DIRECTIVE_LEAF),
			defineBlockComponent(TextEditableBlock, () => ({ blockClass: 'directive-leaf' }))
		);
	}
}
