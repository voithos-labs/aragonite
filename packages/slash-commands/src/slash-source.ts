/**
 * The `/` list: the editor's insert rows, three heading rows and the host's own entries, read fresh
 * from the editor on every keystroke. A pick writes through the editor's `MenuPick`, which removes
 * the `/query` bytes in the same undo step as the block or heading it writes.
 */

import {
	menu,
	type CaretMenu,
	type Editor,
	type InsertRow,
	type MenuIconName,
	type MenuPick
} from '@voithos-labs/aragonite/plugin';
import { acceptsQuery, readQuery, type FilterableEntry } from './filter';

interface SlashCommandEntryBase {
	/** Unique among host rows; a built-in id here replaces that built-in row. */
	id: string;
	label: string;
	icon?: MenuIconName;
	/** Other words the query finds the row by. */
	keywords?: readonly string[];
}

/** A host's own row: Markdown to insert, or a function to run. Never both, never neither. */
export type SlashCommandEntry = SlashCommandEntryBase &
	(
		| { insert: string; run?: never; takesArgument?: never }
		| {
				/** Runs with the pick and the argument typed after a space. The `/query` bytes stay until
				 *  it writes through `pick`, which refuses once the host loads another note. */
				run: (pick: MenuPick, argument?: string) => void | Promise<void>;
				/** Lets the list survive a space, so `/name word` hands `word` to `run`. */
				takesArgument?: boolean;
				insert?: never;
		  }
	);

export interface SlashCommandsOptions {
	/** Rows added after the built-in ones. */
	entries?: readonly SlashCommandEntry[];
	/** Built-in row ids to leave out: an insert row id, or `h1`, `h2`, `h3`. */
	exclude?: readonly string[];
}

/** The Markdown a pick inserts, and the row's dim text. */
type BuiltInsert = { markdown: string; detail?: string };

type SlashAction =
	| { kind: 'insert'; build: (argument: string | null) => BuiltInsert }
	| { kind: 'heading'; level: number }
	| { kind: 'run'; run: (pick: MenuPick, argument?: string) => void | Promise<void> };

interface SlashEntry extends FilterableEntry {
	id: string;
	icon?: MenuIconName;
	action: SlashAction;
}

/** A row as the list shows it, with the word typed after a space when this row takes it. */
interface SlashRow {
	entry: SlashEntry;
	id: string;
	label: string;
	icon?: MenuIconName;
	detail?: string;
	argument: string | null;
}

const HEADING_LEVELS = [1, 2, 3];

/** The `/` menu for one editor's options. */
export function slashMenu(options: SlashCommandsOptions): CaretMenu<SlashRow> {
	const { entries = [], exclude = [] } = options;
	const hidden = new Set([...exclude, ...entries.map((entry) => entry.id)]);
	const hostEntries = entries.map(hostEntry);
	const entriesOf = (editor: Editor): SlashEntry[] => [
		...[...editor.inserts.map(insertEntry), ...HEADING_LEVELS.map(headingEntry)].filter(
			(entry) => !hidden.has(entry.id)
		),
		...hostEntries
	];

	return menu<SlashRow>({
		label: 'Insert a block',
		trigger: '/',
		accepts: (query, { editor }) => acceptsQuery(entriesOf(editor), query),
		rows(query, { editor }) {
			const reading = readQuery(entriesOf(editor), query);
			return (reading?.listed ?? []).map((entry) => {
				const { argument } = reading!;
				const detail = argument === null ? undefined : argumentDetail(entry, argument);
				return { entry, id: entry.id, label: entry.label, icon: entry.icon, detail, argument };
			});
		},
		async pick({ entry: { action }, argument }, pick) {
			if (action.kind === 'heading') await pick.run('heading.cycle', action.level);
			else if (action.kind === 'run') await action.run(pick, argument ?? undefined);
			else await pick.insertBlock(action.build(argument).markdown);
		}
	});
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function insertEntry(row: InsertRow): SlashEntry {
	const { insert } = row;
	return {
		id: row.id,
		label: row.label,
		icon: row.icon,
		keywords: row.keywords ?? [],
		takesArgument: typeof insert === 'function',
		action: {
			kind: 'insert',
			// A space with no word after it yet is no argument, so the row reads an empty word.
			build: (argument) =>
				typeof insert === 'string' ? { markdown: insert } : insert(argument ?? '')
		}
	};
}

function headingEntry(level: number): SlashEntry {
	return {
		id: `h${level}`,
		label: `Heading ${level}`,
		icon: 'heading',
		keywords: [`h${level}`, 'heading', 'title'],
		takesArgument: false,
		action: { kind: 'heading', level }
	};
}

function hostEntry(entry: SlashCommandEntry): SlashEntry {
	const base = {
		id: entry.id,
		label: entry.label,
		icon: entry.icon,
		keywords: entry.keywords ?? []
	};
	if (entry.run) {
		return {
			...base,
			takesArgument: !!entry.takesArgument,
			action: { kind: 'run', run: entry.run }
		};
	}
	const markdown = entry.insert ?? '';
	return { ...base, takesArgument: false, action: { kind: 'insert', build: () => ({ markdown }) } };
}

function argumentDetail(entry: SlashEntry, argument: string): string | undefined {
	if (entry.action.kind === 'insert') return entry.action.build(argument).detail;
	return argument === '' ? undefined : argument;
}
