/**
 * The one consumer opt-in for the `:::name` directive primitive. Importing this
 * module activates the whole feature at load: the side-effect import pulls in the
 * grammar + generic kinds + shared opener, and the block below binds the generic
 * container component. Nothing in the library imports this, so a consumer who
 * never touches directives leaves `:::` unclaimed. Idempotent for HMR / re-import
 * via the public registration probe. Lives in `components/` because it binds a
 * Svelte component — core must not reach the component tree.
 */

import '$lib/core/directive/register';
import {
	registerBlockComponent,
	defineBlockComponent,
	isBlockComponentRegistered,
	declaredPluginKind
} from '$lib/plugin';
import { DIRECTIVE_CONTAINER } from '$lib/core/directive/kinds';
import DirectiveContainerBlock from './DirectiveContainerBlock.svelte';

if (!isBlockComponentRegistered(DIRECTIVE_CONTAINER)) {
	registerBlockComponent(
		declaredPluginKind(DIRECTIVE_CONTAINER),
		defineBlockComponent(DirectiveContainerBlock)
	);
}
