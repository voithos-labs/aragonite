/**
 * GFM footnotes: a strip-container definition plus an inline-widget reference, which jump to
 * each other off their own markers. Numbering is derived off the live document, so no counter
 * is stored anywhere.
 */

import { definePlugin, type EditorPlugin } from '@voithos-labs/aragonite/plugin';
import { svelteBlockView } from '@voithos-labs/aragonite/svelte';
import { registerFootnoteDefinition } from './footnote-definition';
import { registerFootnoteReference } from './footnote-reference';
import FootnoteDefinition from './FootnoteDefinition.svelte';

export function footnotesPlugin(): EditorPlugin {
	return definePlugin({
		name: 'footnotes',
		setup() {
			registerFootnoteDefinition(svelteBlockView(FootnoteDefinition));
			registerFootnoteReference();
		}
	});
}
