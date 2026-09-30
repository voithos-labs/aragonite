/**
 * The blocks a menu can insert: the built-ins, then the entries plugins register, each with the
 * Markdown it inserts. The right-click flyout, `EditorInstance.getInsertCatalogue()` and a plugin's
 * `editor.insertCatalogue` all read this one list, so no two of them can disagree.
 */
import { isMenuIconName, type MenuIconName } from '../menu-icons';
import { legalFenceInfo } from './fenced-code-raw';
import type { PluginActivation } from './plugin-activation';
import { createPluginRegistry } from './plugin-registry';

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
const BUILT_IN: readonly InsertEntry[] = [
	entry('bullet', 'Bulleted list', 'list', ['bullet', 'unordered', 'ul', 'list'], '- '),
	entry('numbered', 'Numbered list', 'list-ordered', ['number', 'ordered', 'ol', 'list'], '1. '),
	entry('todo', 'To-do list', 'square-check', ['todo', 'td', 'task', 'checkbox', 'list'], '- [ ] '),
	entry('quote', 'Quote', 'text-quote', ['blockquote', 'citation'], '> '),
	entry('divider', 'Divider', 'minus', ['rule', 'separator', 'line'], '---\n'),
	entry('code', 'Code block', 'code', ['fence', 'pre', 'snippet'], codeFence(''), codeArgument),
	entry('table', 'Table', 'table', ['grid'], tableMarkdown(DEFAULT_TABLE), tableArgument)
];
const BUILT_IN_IDS = new Set(BUILT_IN.map((e) => e.id));

// Listed in registration order.
const fromPlugins = createPluginRegistry<string, InsertEntry>({
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
		freezeEntry(entry),
		`registerInsertEntry: an insert entry '${entry.id}' is already registered`
	);
}

/** Every entry one editor lists: the built-ins, then each plugin entry `activation` resolves. A
 *  fresh frozen list per call. */
export function insertCatalogue(activation: PluginActivation): readonly InsertEntry[] {
	const listed = fromPlugins.entries(activation).map(([, entry]) => entry);
	return Object.freeze([...BUILT_IN, ...listed]);
}

// ── Internal ─────────────────────────────────────────────────────────────────

function entry(
	id: string,
	label: string,
	icon: MenuIconName,
	keywords: string[],
	markdown: string,
	withArgument?: InsertEntry['withArgument']
): InsertEntry {
	return freezeEntry({
		id,
		label,
		icon,
		keywords,
		markdown,
		...(withArgument && { withArgument })
	});
}

function freezeEntry(entry: InsertEntry): InsertEntry {
	return Object.freeze({ ...entry, keywords: Object.freeze([...entry.keywords]) });
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
	const line = (cell: string) => `|${` ${cell} |`.repeat(columns)}\n`;
	return line('Column') + line('---') + line('').repeat(rows - 1);
}

function sizeLabel({ columns, rows }: TableSize): string {
	return `${columns}×${rows}`;
}
