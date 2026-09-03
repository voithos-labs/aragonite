/**
 * The decoration-source shape on public doors only: onEditor wires a selection-driven
 * mark source, and the scan and its memo stay pure in the sibling modules.
 */

import { definePlugin, type EditorPlugin } from '$lib/plugin';
import { createOccurrenceSource } from './occurrence-source';

export interface HighlightOccurrencesOptions {
	/**
	 * Called when the word index is rebuilt: on a document change, not on a caret move,
	 * carrying how many leaves that rebuild had to tokenize. Public so a harness asserts
	 * the memo against this wiring rather than a copy of it.
	 */
	onScan?: (stats: { tokenizedLeaves: number }) => void;
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
