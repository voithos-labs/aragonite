/**
 * GFM footnotes as a first-party plugin. This milestone ships the definition side
 * only: the `[^label]: content` block, a real editable container. References
 * (`[^label]` inline) land next and register a decoration source on top of this
 * same unit.
 *
 * Numbering is derived, not stored — `assignFootnoteNumbers` reads first-reference
 * order off the live document, so the reference side needs no counter here.
 */

import { definePlugin, type EditorPlugin } from '$lib/plugin';
import { registerFootnoteDefinition } from './footnote-definition';

export function footnotesPlugin(): EditorPlugin {
	return definePlugin({
		name: 'footnotes',
		setup() {
			registerFootnoteDefinition();
		}
	});
}
