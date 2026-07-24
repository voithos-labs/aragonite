/**
 * Highlight-occurrences as a first-party plugin, on public doors only: onEditor →
 * a selection-driven mark source whose scan is memoized on the edit epoch, so a
 * caret move re-filters the cached word index instead of re-walking the document.
 * The scan and the memo are pure (occurrences.ts / occurrence-source.ts).
 */

import { definePlugin, type EditorPlugin } from '$lib/plugin';
import { createOccurrenceSource } from './occurrence-source';

export function highlightOccurrencesPlugin(): EditorPlugin {
	return definePlugin({
		name: 'highlight-occurrences',
		setup(ctx) {
			ctx.onEditor((editor) => {
				const occurrences = createOccurrenceSource();
				const handle = editor.decorations.addSource(occurrences.source);
				const off = editor.events.on('selectionChange', (selection) => {
					occurrences.setSelection(selection);
					handle.invalidate();
				});
				return () => {
					off();
					handle.dispose();
				};
			});
		}
	});
}
