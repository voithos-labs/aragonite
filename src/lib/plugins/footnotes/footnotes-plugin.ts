/**
 * GFM footnotes as a first-party plugin: the `[^label]: content` definition (a
 * real editable strip container) and the `[^label]` reference (a first-class
 * inline widget rendering the derived footnote number as a superscript).
 *
 * Numbering is derived, not stored — `assignFootnoteNumbers` reads first-reference
 * order off the live document, so the reference widget derives its own number and
 * no counter is kept anywhere.
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
