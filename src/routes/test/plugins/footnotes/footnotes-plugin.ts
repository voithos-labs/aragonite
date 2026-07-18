/**
 * GFM footnotes as a third-party plugin unit. Two halves:
 *   - the `[^label]: content` definition, a real block kind + opener (setup);
 *   - the `[^label]` reference, a per-instance decoration source (onEditor),
 *     because the inline tier cannot claim the `[` trigger.
 *
 * Numbering is derived, not stored: both halves read first-reference order off
 * the live document through `footnote-numbering`.
 */

import { definePlugin, type EditorPlugin } from '$lib/plugin';
import { registerFootnoteDefinition } from './footnote-definition';
import { footnoteReferenceSource } from './footnote-references';

export function footnotesPlugin(): EditorPlugin {
	return definePlugin({
		name: 'footnotes',
		setup(ctx) {
			registerFootnoteDefinition();
			ctx.onEditor((editor) => {
				const handle = editor.decorations.addSource(footnoteReferenceSource());
				return () => handle.dispose();
			});
		}
	});
}
