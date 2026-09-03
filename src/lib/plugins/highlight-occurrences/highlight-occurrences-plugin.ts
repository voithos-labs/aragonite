/**
 * The decoration-source shape on public doors only: onEditor wires a mark source to the
 * selection and edit channels, and the scan, its memo and the typing gate stay pure in
 * the sibling modules.
 */

import { definePlugin, type EditorPlugin } from '$lib/plugin';
import { createOccurrenceSource } from './occurrence-source';

export interface HighlightOccurrencesOptions {
	/** `false` attaches nothing to an editor; per instance through `{ plugin, options }`. */
	enabled?: boolean;
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
				// Installation is process-wide and every editor runs every installed hook, so the
				// per-editor switch lives here rather than in the plugins prop.
				const perInstance = editor.options as HighlightOccurrencesOptions | undefined;
				if ((perInstance?.enabled ?? options.enabled) === false) return;
				const occurrences = createOccurrenceSource({ onScan: options.onScan });
				const handle = editor.decorations.addSource(occurrences.source);
				const offSelection = editor.events.on('selectionChange', (selection) => {
					occurrences.setSelection(selection);
					handle.invalidate();
				});
				const offEdit = editor.events.on('edit', ({ op }) => {
					if (occurrences.noteEdit(op)) handle.invalidate();
				});
				return () => {
					offSelection();
					offEdit();
					handle.dispose();
				};
			});
		}
	});
}
