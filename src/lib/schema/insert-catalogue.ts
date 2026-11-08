/**
 * The blocks a menu can insert: the built-ins, then the rows plugins add, each with the Markdown it
 * inserts. The right-click flyout, an editor's `inserts` and a `setup` plugin's
 * `editor.insertCatalogue` all read this one list, so no two of them can disagree.
 */
import { newTableLines } from '../core/parsers/table-line';
import { isMenuIconName, type MenuIconName } from '../menu-icons';
import { legalFenceInfo } from './fenced-code-raw';
import type { PluginActivation } from './plugin-activation';
import { createPluginRegistry } from './plugin-registry';
import { isValidPluginName } from './plugin-name';

/** A row of the insert menus (the right-click flyout, the `/` list, a host's `+` button). */
export interface InsertRow {
	/** Unique in the list; an editor lists a plugin's as `plugin/id`. */
	readonly id: string;
	readonly label: string;
	readonly icon: MenuIconName;
	/** Other words a filter should find the row by: `todo` for "To-do list". */
	readonly keywords?: readonly string[];
	/** The Markdown it inserts, or a function of the word typed after it (`/table 3x4`, empty when
	 *  none was) giving the Markdown and the dim text saying how the word was read. */
	readonly insert: string | ((word: string) => { markdown: string; detail?: string });
}

/** What `registerInsertEntry` takes: a `setup` plugin's row. */
export interface InsertEntry {
	readonly id: string;
	readonly label: string;
	readonly icon: MenuIconName;
	/** Other words a filter should find the entry by: `todo` for "To-do list". */
	readonly keywords: readonly string[];
	/** Handed to the paste path as is, the way `insertMarkdown` takes it. */
	readonly markdown: string;
	/** The Markdown for the word typed after the entry (`/table 3x4`; the word is never empty),
	 *  and the dim text saying how it was read. Absent: the entry takes no argument. */
	readonly withArgument?: (argument: string) => { markdown: string; detail?: string };
}

interface TableSize {
	columns: number;
	/** The header row counts, so the default two-row table is a header and one empty row. */
	rows: number;
}

const DEFAULT_TABLE: TableSize = { columns: 2, rows: 2 };
const MAX_COLUMNS = 20;
const MAX_ROWS = 100;
const TABLE_HINT = 'columns×rows, like 3x4';

// A heading is not here: it is text turned into a heading, which the selection toolbar offers.
const BUILT_IN: readonly InsertRow[] = [
	frozenRow('bullet', 'Bulleted list', 'list', ['bullet', 'unordered', 'ul', 'list'], '- '),
	frozenRow(
		'numbered',
		'Numbered list',
		'list-ordered',
		['number', 'ordered', 'ol', 'list'],
		'1. '
	),
	frozenRow(
		'todo',
		'To-do list',
		'square-check',
		['todo', 'td', 'task', 'checkbox', 'list'],
		'- [ ] '
	),
	frozenRow('quote', 'Quote', 'text-quote', ['blockquote', 'citation'], '> '),
	frozenRow('divider', 'Divider', 'minus', ['rule', 'separator', 'line'], '---\n'),
	frozenRow('code', 'Code block', 'code', ['fence', 'pre', 'snippet'], codeArgument),
	frozenRow('table', 'Table', 'table', ['grid'], tableArgument)
];
const BUILT_IN_IDS = new Set(BUILT_IN.map((e) => e.id));

// Listed in registration order.
const fromPlugins = createPluginRegistry<string, InsertRow>({
	label: 'registerInsertEntry',
	isBuiltin: () => false
});

/**
 * Call from a plugin's `setup`: the entry is listed after the built-ins, and only in editors that
 * activated that plugin. Throws on a taken id or an icon name the menu cannot draw.
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
	fromPlugins.register(
		entry.id,
		rowOf(entry),
		`registerInsertEntry: an insert entry '${entry.id}' is already registered`
	);
}

/** Every row one editor lists: the built-ins, each `setup` plugin entry `activation` resolves,
 *  then the rows its plugin values contribute. A fresh frozen list per call. */
export function insertRows(activation: PluginActivation): readonly InsertRow[] {
	const registered = fromPlugins.entries(activation).map(([, entry]) => entry);
	return Object.freeze([...BUILT_IN, ...registered, ...(activation.contributions?.inserts ?? [])]);
}

/** The Markdown a row inserts for the word typed after it, empty when none was. */
export function rowMarkdown(row: InsertRow, word = ''): string {
	return typeof row.insert === 'string' ? row.insert : row.insert(word).markdown;
}

/** Why a plugin value's row can't be listed, or null. */
export function insertRowProblem(row: InsertRow): string | null {
	if (!isValidPluginName(row.id)) {
		return `has an insert row id "${row.id}"; lowercase first letter, then letters/digits/hyphens`;
	}
	return isMenuIconName(row.icon) ? null : `names icon '${row.icon}', which the menu cannot draw`;
}

// ── Internal ─────────────────────────────────────────────────────────────────

function frozenRow(
	id: string,
	label: string,
	icon: MenuIconName,
	keywords: string[],
	insert: InsertRow['insert']
): InsertRow {
	return Object.freeze({ id, label, icon, keywords: Object.freeze(keywords), insert });
}

// A `setup` plugin's entry reads its default Markdown until a word is typed.
function rowOf(entry: InsertEntry): InsertRow {
	const { withArgument, markdown } = entry;
	const insert = withArgument
		? (word: string) => (word ? withArgument(word) : { markdown })
		: markdown;
	return frozenRow(entry.id, entry.label, entry.icon, [...entry.keywords], insert);
}

// ── Arguments ────────────────────────────────────────────────────────────────

function codeFence(info: string): string {
	return `\`\`\`${info}\n\n\`\`\`\n`;
}

// The code block's own info-string rule, so the fence reads as if the language were typed on it.
function codeArgument(language: string) {
	const info = legalFenceInfo(language, '`');
	return { markdown: codeFence(info), detail: info || 'no language' };
}

/** A malformed size inserts the default table and says how to write one, so Enter always inserts. */
function tableArgument(argument: string) {
	const size = parseTableSize(argument);
	if (!size) {
		const hint = `${sizeLabel(DEFAULT_TABLE)} · ${TABLE_HINT}`;
		return { markdown: tableMarkdown(DEFAULT_TABLE), detail: hint };
	}
	return { markdown: tableMarkdown(size), detail: sizeLabel(size) };
}

/** `3x4` (or `3X4`, `3×4`) is three columns and four rows; null for anything else. */
function parseTableSize(argument: string): TableSize | null {
	const match = /^(\d+)[xX×](\d+)$/.exec(argument);
	if (!match) return null;
	const size = { columns: Number(match[1]), rows: Number(match[2]) };
	const fits =
		size.columns >= 1 && size.columns <= MAX_COLUMNS && size.rows >= 2 && size.rows <= MAX_ROWS;
	return fits ? size : null;
}

function tableMarkdown({ columns, rows }: TableSize): string {
	const header = Array<string>(columns).fill('Column');
	return `${newTableLines(header, rows - 1).join('\n')}\n`;
}

function sizeLabel({ columns, rows }: TableSize): string {
	return `${columns}×${rows}`;
}
