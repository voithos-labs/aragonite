/**
 * Highlight-occurrences as a first-party plugin, on public doors only: onEditor →
 * a selection-driven mark source whose scan is memoized on the edit epoch, so a
 * caret move re-filters the cached word index instead of re-walking the document.
 * The scan and the memo are pure (occurrences.ts / occurrence-source.ts).
 */

import { definePlugin, type EditorPlugin } from '$lib/plugin';
import { createOccurrenceSource } from './occurrence-source';

export interface HighlightOccurrencesOptions {
	/**
	 * Called whenever the word index is rebuilt — i.e. on an edit, not on a caret
	 * move, which re-filters the cached index. The observability hook the memo
	 * behaviour is asserted through; without it a harness has to re-declare this
	 * wiring against a private module and then pins its own copy, not this one.
	 */
	onScan?: () => void;
}

export function highlightOccurrencesPlugin(
	options: HighlightOccurrencesOptions = {}
): EditorPlugin {
	return definePlugin({
		name: 'highlight-occurrences',
		setup(ctx) {
			ctx.onEditor((editor) => {
				const occurrences = createOccurrenceSource({ onScan: options.onScan });
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
