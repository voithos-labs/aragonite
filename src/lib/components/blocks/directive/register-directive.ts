/**
 * The one consumer opt-in for the `:::name` directive primitive. Importing this
 * module activates the whole feature at load: the side-effect import pulls in the
 * grammar + generic kinds + shared opener, and the blocks below bind the generic
 * container and single-line leaf components. Nothing in the library imports this,
 * so a consumer who never touches directives leaves `:::` unclaimed. Idempotent
 * for HMR / re-import via the public registration probe. Lives in `components/`
 * because it binds Svelte components — core must not reach the component tree.
 */

import '$lib/core/directive/register';
import {
	registerBlockComponent,
	defineBlockComponent,
	isBlockComponentRegistered,
	declaredPluginKind
} from '$lib/plugin';
import { DIRECTIVE_CONTAINER, DIRECTIVE_LEAF } from '$lib/core/directive/kinds';
import DirectiveContainerBlock from './DirectiveContainerBlock.svelte';
import TextEditableBlock from '../text/TextEditableBlock.svelte';

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
