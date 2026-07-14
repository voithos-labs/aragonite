// Dogfood for a selection-driven mark source on public doors only: onEditor →
// addSource whose provide scans for the word under the caret, re-run by
// invalidate() on every selectionChange. The scan itself is pure (occurrences.ts).
import { definePlugin } from '$lib/plugin';
import type { EditorSelection } from '$lib';
import { occurrenceMarks } from './occurrences';

export const highlightOccurrencesPlugin = definePlugin({
	name: 'highlight-occurrences',
	setup(ctx) {
		ctx.onEditor((editor) => {
			let selection: EditorSelection | null = null;
			const handle = editor.decorations.addSource({
				name: 'highlight-occurrences',
				provide: (doc) => occurrenceMarks(doc, selection)
			});
			const off = editor.events.on('selectionChange', (sel) => {
				selection = sel;
				handle.invalidate();
			});
			return () => {
				off();
				handle.dispose();
			};
		});
	}
});
