/**
 * GFM footnotes: a strip-container definition plus an inline-widget reference.
 * Numbering is derived off the live document, so no counter is stored anywhere.
 */

import { definePlugin, type EditorPlugin } from '$lib/plugin';
import { registerFootnoteDefinition } from './footnote-definition';
import { registerFootnoteReference } from './footnote-reference';

export function footnotesPlugin(): EditorPlugin {
	return definePlugin({
		name: 'footnotes',
		setup() {
			registerFootnoteDefinition();
			registerFootnoteReference();
		}
	});
}
