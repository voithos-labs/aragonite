/**
 * Tags inside the text, done the other way: a mark decoration over ordinary characters, not an
 * inline widget. A tag's source is what it shows, so nothing has to be uncovered and the caret
 * walks straight through: one character per arrow key, one byte per Backspace, and selection,
 * copy and IME stay the browser's. The decorations re-run on every document change, so the chip
 * follows the bytes without asking for a refresh of its own.
 */

import { definePlugin } from '$lib/plugin';
import type { DocumentView, EditorPlugin, InlineMenuItem, MarkDecoration } from '$lib/plugin';
import { forEachLeaf } from '../walk-views';
import { isTagOpening, isTagQuery, recognizeTag } from './tag-scan';

export const TAG_MARK_CLASS = 'body-tag-mark';
export const TAG_MENU = 'harness-tags';

export function tagMarksPlugin(): EditorPlugin {
	return definePlugin({
		name: 'harness-tag-marks',
		setup(ctx) {
			ctx.onEditor((editor) => {
				const handle = editor.decorations.addSource({
					name: 'harness-tag-marks',
					provide: (doc) => tagMarks(doc)
				});
				// Autocomplete over the tags the document already holds. The editor owns the session:
				// it notices the typed `#`, holds the arrow keys, and writes the pick as one undo entry.
				const menu = editor.inlineMenus.addSource({
					name: TAG_MENU,
					trigger: '#',
					opensAt: isTagOpening,
					accepts: isTagQuery,
					items: ({ query, path, start }) => tagItems(editor.document, query, path, start)
				});
				return () => {
					handle.dispose();
					menu.dispose();
				};
			});
		}
	});
}

function tagMarks(doc: DocumentView): MarkDecoration[] {
	const marks: MarkDecoration[] = [];
	forEachLeaf(doc.children, (node, path) => {
		const raw = node.raw;
		for (let i = raw.indexOf('#'); i !== -1; i = raw.indexOf('#', i + 1)) {
			const span = recognizeTag(raw, i, raw.length);
			if (!span) continue;
			marks.push({
				type: 'mark',
				path,
				start: span.start,
				end: span.end,
				class: TAG_MARK_CLASS,
				attrs: { 'data-tag': span.name }
			});
			i = span.end - 1;
		}
	});
	return marks;
}

/** The document's other tags that start with the query, most used first. The tag under the caret
 *  is left out of the count: it is the query, not a suggestion. */
function tagItems(
	doc: DocumentView,
	query: string,
	at: readonly number[],
	start: number
): InlineMenuItem[] {
	const counts = new Map<string, number>();
	const here = at.join();
	forEachLeaf(doc.children, (node, path) => {
		const raw = node.raw;
		for (let i = raw.indexOf('#'); i !== -1; i = raw.indexOf('#', i + 1)) {
			const span = recognizeTag(raw, i, raw.length);
			if (!span) continue;
			if (!(i === start && path.join() === here)) {
				counts.set(span.name, (counts.get(span.name) ?? 0) + 1);
			}
			i = span.end - 1;
		}
	});
	const wanted = query.toLowerCase();
	return [...counts]
		.filter(([name]) => name.toLowerCase().startsWith(wanted) && name !== query)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 8)
		.map(([name, count]) => ({
			id: name,
			label: `#${name}`,
			detail: String(count),
			insert: `#${name}`
		}));
}
