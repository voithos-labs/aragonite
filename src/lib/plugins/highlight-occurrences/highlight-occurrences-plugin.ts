/**
 * A decoration source built on public API alone: `onEditor` wires a mark source to the
 * selection, edit and source-swap events, and times the typing pause that brings the marks back;
 * the scan, its cache and the pause-while-typing rule stay pure in the sibling modules.
 */

import { definePlugin, type EditorPlugin } from '$lib/plugin';
import { createOccurrenceSource } from './occurrence-source';

export interface HighlightOccurrencesOptions {
	/** Called when the word index is rebuilt (a document change, not a caret move) with how many
	 *  blocks it tokenized; public so a test can check this wiring's caching. */
	onScan?: (stats: { tokenizedLeaves: number }) => void;
}

/** How long typing stops before the marks come back: this plugin's own quarter second. */
export const TYPING_PAUSE_MS = 250;

export function highlightOccurrencesPlugin(
	options: HighlightOccurrencesOptions = {}
): EditorPlugin {
	return definePlugin({
		name: 'highlight-occurrences',
		setup(ctx) {
			ctx.onEditor((editor) => {
				const occurrences = createOccurrenceSource({ onScan: options.onScan });
				const handle = editor.decorations.addSource(occurrences.source);
				let pause: ReturnType<typeof setTimeout> | undefined;
				const offSelection = editor.events.on('selectionChange', (selection) => {
					occurrences.setSelection(selection);
					handle.invalidate();
				});
				const offEdit = editor.events.on('edit', ({ op }) => {
					clearTimeout(pause);
					if (op === 'input') {
						// A real-time pause (G4.4 allowlist): no event says the author stopped typing.
						pause = setTimeout(() => {
							if (occurrences.noteTypingPause()) handle.invalidate();
						}, TYPING_PAUSE_MS);
					}
					if (occurrences.noteEdit(op)) handle.invalidate();
				});
				const offSourceSwap = editor.events.on('sourceSwap', () => {
					clearTimeout(pause);
					if (occurrences.noteSourceSwap()) handle.invalidate();
				});
				return () => {
					clearTimeout(pause);
					offSelection();
					offEdit();
					offSourceSwap();
					handle.dispose();
				};
			});
		}
	});
}
