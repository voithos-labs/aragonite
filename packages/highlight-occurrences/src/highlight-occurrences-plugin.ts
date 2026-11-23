/**
 * Every place the word under the caret appears, marked: a paint over each block of prose, asked
 * again when the word changes. The marks hide while you type and come back once typing pauses, or
 * at once on any other edit or a new document.
 */

import { definePlugin } from '@voithos-labs/aragonite/plugin';
import { occurrenceMarks, wordAtCaret } from './occurrences';
import { TYPING_PAUSE_MS } from './typing-pause';

/** List `highlightOccurrences` in an editor's plugins, and style `.decoration-overlay.hl-occurrence`. */
export const highlightOccurrences = definePlugin({
	name: 'highlight-occurrences',
	version: '0.11.5',
	editor: '0.11.5',
	contributes() {
		let word: string | null = null;
		let typing = false;
		const marked = () => (typing ? null : word);
		return {
			paint(block) {
				const shown = marked();
				return shown === null ? [] : occurrenceMarks(block, shown);
			},
			setup(editor) {
				let pause: ReturnType<typeof setTimeout> | undefined;
				// Only a change in what's marked asks the blocks on screen again.
				const settle = (next: { word?: string | null; typing?: boolean }) => {
					const was = marked();
					if (next.word !== undefined) word = next.word;
					if (next.typing !== undefined) typing = next.typing;
					if (marked() !== was) editor.repaint();
				};
				editor.on('selection', () => settle({ word: wordAtCaret(editor) }));
				editor.on('edit', ({ op }) => {
					clearTimeout(pause);
					if (op !== 'input') return settle({ typing: false });
					// A real-time pause (G4.4 allowlist): no event says the author stopped typing.
					pause = setTimeout(() => settle({ typing: false }), TYPING_PAUSE_MS);
					settle({ typing: true });
				});
				editor.on('load', () => {
					clearTimeout(pause);
					settle({ word: wordAtCaret(editor), typing: false });
				});
				return () => clearTimeout(pause);
			}
		};
	}
});
