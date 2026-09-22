/**
 * A `/` command list, the harness's third inline-menu source and the only one whose pick inserts
 * a block. A pick's bytes hold no line break, so `insert` is empty (it removes the `/` and the
 * query) and `onCommit` puts the snippet in through the instance's `insertMarkdown`. Registered
 * from the page rather than a plugin, because a plugin's context has no `insertMarkdown`.
 */
import type { InlineMenuSource } from '$lib';

export const SLASH_MENU = 'harness-slash';

const SNIPPETS = [
	{ id: 'quote', label: 'Quote', md: '> ' },
	{ id: 'rule', label: 'Rule', md: '---' },
	{ id: 'code', label: 'Code block', md: '```\n\n```' }
];

export function slashMenuSource(insertMarkdown: (md: string) => boolean): InlineMenuSource {
	return {
		name: SLASH_MENU,
		trigger: '/',
		// A slash inside a word (a path, a date) is text.
		opensAt: (raw, pos) => pos === 0 || /\s/.test(raw[pos - 1]),
		accepts: (query) => /^[\w-]*$/.test(query),
		items: ({ query }) => {
			const wanted = query.toLowerCase();
			return SNIPPETS.filter((snippet) => snippet.id.startsWith(wanted)).map((snippet) => ({
				id: snippet.id,
				label: snippet.label,
				insert: ''
			}));
		},
		onCommit: (item) => {
			const snippet = SNIPPETS.find((candidate) => candidate.id === item.id);
			if (snippet) insertMarkdown(snippet.md);
		}
	};
}
