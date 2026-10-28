/**
 * Turns on the `:::name` directive syntax: the grammar plus the generic container and leaf
 * views. Exported from `@voithos-labs/aragonite/plugin`; a consumer that never calls it leaves
 * `:::` as ordinary text. Lives in `components/` because it binds Svelte components, which core
 * may not import. Calling it twice is safe.
 */

import { activateDirectiveGrammar } from '#lib/core/directive/activate.js';
import { DIRECTIVE_OPENER_LINE } from '#lib/core/directive/kinds.js';
import { declaredPluginKind } from '#lib/schema/plugin-kind.js';
import { registerTitleRowPasteSurface } from '#lib/editor-actions/plugin/chrome-leaf.js';
import { svelteBlockView } from '#lib/components/svelte-block-view.js';
import { registerAsCore } from '#lib/schema/plugin-install.js';
import DirectiveContainerBlock from './DirectiveContainerBlock.svelte';
import { textBlockView } from '../text/text-block-view';

export function activateDirectives(): void {
	// The shared directive kinds and their views belong to no plugin, whichever plugin's setup turns
	// directives on, so an editor that left that plugin out still reads `:::name` as generic.
	registerAsCore(() => {
		activateDirectiveGrammar({
			container: svelteBlockView(DirectiveContainerBlock),
			// The leaf's descriptor already drives its dimmed marker and split behavior.
			leaf: textBlockView({ blockClass: 'directive-leaf' }),
			// Live mode shows the line's source while the caret is on it, its container's look otherwise.
			openerLine: textBlockView({ blockClass: 'directive-opener-line', sourceAtCaret: true })
		});
		registerTitleRowPasteSurface(declaredPluginKind(DIRECTIVE_OPENER_LINE));
	});
}
