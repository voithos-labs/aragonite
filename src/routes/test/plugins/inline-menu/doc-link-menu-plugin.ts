/**
 * A document picker on `[[`, the shape a host's wikilink menu takes: a two-byte trigger, a query
 * that may hold spaces, and a list that arrives asynchronously, as one read off an index does. The
 * editor has no `[[…]]` construct of its own, so the pick lands as plain text, which is all the
 * menu promises: the bytes, the caret after them, one undo entry.
 */
import { definePlugin, menu, type MenuRow } from '#lib/plugin.js';

const DOCUMENTS = [
	{ title: 'Meeting notes', path: 'work/Meeting notes' },
	{ title: 'Meal plan', path: 'home/Meal plan' },
	{ title: 'Roadmap', path: 'work/Roadmap' },
	{ title: 'Reading list', path: 'Reading list' }
];

/** The menu itself, so the harness's "Link document" button can open it by value. */
export const docLinkMenu = menu<MenuRow>({
	label: 'Link a document',
	trigger: '[[',
	where: 'anywhere',
	// A closing bracket is the author finishing the link by hand.
	accepts: (query) => !/[\]\n]/.test(query),
	async rows(query) {
		// A turn late, as a read off an index would be; a timer would sequence by timing, which the
		// source scans forbid (G4.4).
		await Promise.resolve();
		const wanted = query.trim().toLowerCase();
		return DOCUMENTS.filter((doc) => doc.title.toLowerCase().includes(wanted)).map((doc) => ({
			id: doc.path,
			label: doc.title,
			detail: doc.path
		}));
	},
	pick: (row, pick) => void pick.write(`[[${row.label}]]`)
});

export const docLinkMenuPlugin = definePlugin({
	name: 'harness-doc-link-menu',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ menus: [docLinkMenu] })
});
