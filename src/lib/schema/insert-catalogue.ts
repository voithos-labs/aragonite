/**
 * The blocks a menu can insert: the built-ins, then the entries plugins register, each with the
 * Markdown it inserts. The right-click flyout, `EditorInstance.getInsertCatalogue()` and a plugin's
 * `editor.insertCatalogue` all read this one list, so no two of them can disagree.
 */
import { isMenuIconName, type MenuIconName } from '../menu-icons';
import { currentInstallingPlugin, isPluginInstalled } from './plugin-install';
import { registerOnce } from './register-once';

export interface InsertEntry {
	readonly id: string;
	readonly label: string;
	readonly icon: MenuIconName;
	/** Other words a filter should find the entry by: `todo` for "To-do list". */
	readonly keywords: readonly string[];
	/** Handed to the paste path as is, the way `insertMarkdown` takes it. */
	readonly markdown: string;
}

// A heading is not here: it is text turned into a heading, which the selection toolbar offers.
const BUILT_IN: readonly InsertEntry[] = [
	entry('bullet', 'Bulleted list', 'list', ['bullet', 'unordered', 'ul', 'list'], '- '),
	entry('numbered', 'Numbered list', 'list-ordered', ['number', 'ordered', 'ol', 'list'], '1. '),
	entry('todo', 'To-do list', 'square-check', ['todo', 'td', 'task', 'checkbox', 'list'], '- [ ] '),
	entry('quote', 'Quote', 'text-quote', ['blockquote', 'citation'], '> '),
	entry('divider', 'Divider', 'minus', ['rule', 'hr', 'separator', 'line'], '---\n'),
	entry('code', 'Code block', 'code', ['fence', 'pre', 'snippet'], '```\n\n```\n'),
	entry('table', 'Table', 'table', ['grid'], '| Column | Column |\n| --- | --- |\n|  |  |\n')
];
const BUILT_IN_IDS = new Set(BUILT_IN.map((e) => e.id));

/** Registration order; the owner is the plugin whose setup registered the entry, or null. */
const fromPlugins = new Map<string, { entry: InsertEntry; owner: string | null }>();

/**
 * Add a block to every insert menu, listed after the built-ins in registration order. Call it
 * from a plugin's `setup`: the entry is listed only in an editor that activated that plugin.
 * Throws on an id already taken and on an icon name the menu cannot draw.
 */
export function registerInsertEntry(entry: InsertEntry): void {
	if (!isMenuIconName(entry.icon)) {
		throw new Error(
			`registerInsertEntry: '${entry.id}' names icon '${entry.icon}', which the menu cannot draw`
		);
	}
	if (BUILT_IN_IDS.has(entry.id)) {
		throw new Error(`registerInsertEntry: '${entry.id}' is a built-in insert entry`);
	}
	const owner = currentInstallingPlugin();
	registerOnce(
		fromPlugins.has(entry.id),
		() => fromPlugins.set(entry.id, { entry: freezeEntry(entry), owner }),
		`registerInsertEntry: an insert entry '${entry.id}' is already registered`
	);
}

/**
 * Every entry one editor lists: the built-ins, then each plugin entry whose plugin installed
 * cleanly and `isActive` says this editor activated. A fresh frozen list per call.
 */
export function insertCatalogue(isActive: (plugin: string) => boolean): readonly InsertEntry[] {
	const listed = [...fromPlugins.values()]
		.filter(({ owner }) => owner === null || (isPluginInstalled(owner) && isActive(owner)))
		.map(({ entry }) => entry);
	return Object.freeze([...BUILT_IN, ...listed]);
}

export function __removePluginInsertEntriesForTests(): void {
	fromPlugins.clear();
}

// ── Internal ─────────────────────────────────────────────────────────────────

function entry(
	id: string,
	label: string,
	icon: MenuIconName,
	keywords: string[],
	markdown: string
): InsertEntry {
	return freezeEntry({ id, label, icon, keywords, markdown });
}

function freezeEntry(entry: InsertEntry): InsertEntry {
	return Object.freeze({ ...entry, keywords: Object.freeze([...entry.keywords]) });
}
