/**
 * Tags inside the text as marks over ordinary characters, not an inline widget, plus a `#` menu over
 * the tags the document already holds. A tag's source is what it shows, so the caret walks straight
 * through it. The showcase lists the plugin, and so do the harness's tag seeds.
 */

import { definePlugin, menu, type Block, type Doc, type MenuRow } from '#lib/plugin.js';
import { isTagQuery, recognizeTag, type TagSpan } from './tag-scan';

export const TAG_MARK_CLASS = 'body-tag-mark';

/** The `#` menu, so a harness button can open it by value. */
export const tagMenu = menu<MenuRow & { insert: string }>({
	label: 'Tags',
	trigger: '#',
	accepts: isTagQuery,
	rows: (query, { editor }) => {
		// The tag being typed is the query, not a suggestion, so its own bytes are left out.
		const typing = editor.selection ? editor.selection.head - query.length - 1 : -1;
		return tagRows(editor.doc, query, typing);
	},
	pick: (row, pick) => void pick.write(row.insert)
});

export const tagMarks = definePlugin({
	name: 'harness-tag-marks',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		paint: (block) =>
			tagsIn(block).map(({ span, from }) => ({
				type: 'mark' as const,
				from,
				to: from + span.end - span.start,
				class: TAG_MARK_CLASS,
				attrs: { 'data-tag': span.name }
			})),
		menus: [tagMenu]
	})
});

// ── Internal ────────────────────────────────────────────────────────────────

/** Each tag in a block's text, with the document byte its `#` sits at. */
function tagsIn(block: Block): { span: TagSpan; from: number }[] {
	const found: { span: TagSpan; from: number }[] = [];
	const text = block.text;
	for (let i = text.indexOf('#'); i !== -1; i = text.indexOf('#', i + 1)) {
		const span = recognizeTag(text, i, text.length);
		if (!span) continue;
		found.push({ span, from: block.byteAt(span.start) });
		i = span.end - 1;
	}
	return found;
}

/** The document's other tags that start with the query, most used first. */
function tagRows(doc: Doc, query: string, typing: number): (MenuRow & { insert: string })[] {
	const counts = new Map<string, number>();
	for (const block of doc.walk()) {
		if (block.children.length > 0) continue;
		for (const { span, from } of tagsIn(block)) {
			if (from !== typing) counts.set(span.name, (counts.get(span.name) ?? 0) + 1);
		}
	}
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
