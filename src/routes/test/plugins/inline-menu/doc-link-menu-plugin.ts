/**
 * A document picker on `[[`, the shape a host's wikilink menu takes: a two-byte trigger, a query
 * that may hold spaces, and a list that arrives asynchronously, as one read off an index does. The
 * editor has no `[[…]]` construct of its own, so the pick lands as plain text, which is all the
 * menu promises: the bytes, the caret after them, one undo entry.
 */
import { definePlugin } from '$lib/plugin';
import type { EditorPlugin } from '$lib/plugin';

export const DOC_LINK_MENU = 'harness-doc-links';

const DOCUMENTS = [
	{ title: 'Meeting notes', path: 'work/Meeting notes' },
	{ title: 'Meal plan', path: 'home/Meal plan' },
	{ title: 'Roadmap', path: 'work/Roadmap' },
	{ title: 'Reading list', path: 'Reading list' }
];

export function docLinkMenuPlugin(): EditorPlugin {
	return definePlugin({
		name: 'harness-doc-link-menu',
		setup(ctx) {
			ctx.onEditor((editor) => {
				const handle = editor.inlineMenus.addSource({
					name: DOC_LINK_MENU,
					trigger: '[[',
					// A closing bracket is the author finishing the link by hand.
					accepts: (query) => !/[\]\n]/.test(query),
					items: async ({ query, signal }) => {
						// The answer arrives a turn late, as a read off an index would. Supersession
						// under real latency is pinned in the state's unit battery, which can hold a
						// promise open; a timer here would be the sequencing hack G4.4 forbids.
						await Promise.resolve();
						if (signal.aborted) return [];
						const wanted = query.trim().toLowerCase();
						return DOCUMENTS.filter((doc) => doc.title.toLowerCase().includes(wanted)).map(
							(doc) => ({
								id: doc.path,
								label: doc.title,
								detail: doc.path,
								insert: `[[${doc.title}]]`
							})
						);
					}
				});
				return () => handle.dispose();
			});
		}
	});
}
