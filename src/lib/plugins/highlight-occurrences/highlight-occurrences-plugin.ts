/**
 * A decoration source built on public API alone: `onEditor` wires a mark source to the
 * selection, edit and source-swap events; the scan, its cache and the pause-while-typing rule
 * stay pure in the sibling modules.
 */

import { definePlugin, type EditorPlugin } from '$lib/plugin';
import { createOccurrenceSource } from './occurrence-source';

export interface HighlightOccurrencesOptions {
	/**
	 * Called when the word index is rebuilt: on a document change, not on a caret move, with
	 * how many blocks that rebuild had to tokenize. Public so a test can check the caching
	 * against this wiring rather than a copy of it.
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
				const offSelection = editor.events.on('selectionChange', (selection) => {
					occurrences.setSelection(selection);
					handle.invalidate();
				});
				const offEdit = editor.events.on('edit', ({ op }) => {
					if (occurrences.noteEdit(op)) handle.invalidate();
				});
				const offSourceSwap = editor.events.on('sourceSwap', () => {
					if (occurrences.noteSourceSwap()) handle.invalidate();
				});
				return () => {
					offSelection();
					offEdit();
					offSourceSwap();
					handle.dispose();
				};
			});
		}
	});
}
