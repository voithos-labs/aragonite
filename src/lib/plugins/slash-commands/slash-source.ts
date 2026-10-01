/**
 * The `/` list: the insert catalogue, three heading rows and the host's own entries, read fresh
 * from the editor on every keystroke. A pick removes the `/query` bytes first (its `insert` is
 * empty), then `onCommit` does the row's work through the editor's own entry points.
 */

import {
	blockNodeAt,
	isBlankText,
	type EditorContext,
	type InlineMenuSource,
	type InsertEntry,
	type MenuIconName
} from '$lib/plugin';
import { acceptsQuery, filterEntries, splitQuery, type FilterableEntry } from './filter';

export const SLASH_COMMANDS_MENU = 'slash-commands';

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
				/** Runs after the `/query` bytes are gone, with the argument typed after a space. */
				run: (editor: EditorContext, argument?: string) => void;
				/** Lets the list survive a space, so `/name word` hands `word` to `run`. */
				takesArgument?: boolean;
				insert?: never;
		  }
	);

export interface SlashCommandsOptions {
	/** Rows added after the built-in ones. */
	entries?: readonly SlashCommandEntry[];
	/** Built-in row ids to leave out: an insert catalogue id, or `h1`, `h2`, `h3`. */
	exclude?: readonly string[];
}

/** The Markdown a pick inserts, and the row's dim text. */
type BuiltInsert = ReturnType<NonNullable<InsertEntry['withArgument']>>;

type SlashAction =
	| { kind: 'insert'; build: (argument: string | null) => BuiltInsert }
	| { kind: 'heading'; level: number }
	| { kind: 'run'; run: (editor: EditorContext, argument?: string) => void };

interface SlashRow extends FilterableEntry {
	id: string;
	icon?: MenuIconName;
	action: SlashAction;
}

const HEADING_LEVELS = [1, 2, 3];

/** The `/` source for one editor: its rows come from `editor.options` and the live catalogue. */
export function createSlashSource(editor: EditorContext<SlashCommandsOptions>): InlineMenuSource {
	function rows(): SlashRow[] {
		const { entries = [], exclude = [] } = editor.options;
		const hidden = new Set([...exclude, ...entries.map((entry) => entry.id)]);
		const builtIn = [
			...editor.insertCatalogue.map(catalogueRow),
			...HEADING_LEVELS.map(headingRow)
		];
		return [...builtIn.filter((row) => !hidden.has(row.id)), ...entries.map(hostRow)];
	}

	return {
		name: SLASH_COMMANDS_MENU,
		trigger: '/',
		// A slash inside a word (`and/or`, `9/22`) is text.
		opensAt: (raw, pos) => pos === 0 || /\s/.test(raw[pos - 1]),
		accepts: (query) => acceptsQuery(rows(), query),
		items: ({ query }) => {
			const { head, argument } = splitQuery(query);
			return filterEntries(rows(), head).map((row) => ({
				id: row.id,
				label: row.label,
				icon: row.icon,
				detail: argument === null ? undefined : argumentDetail(row, argument),
				insert: ''
			}));
		},
		onCommit: async (item, commit) => {
			const row = rows().find((candidate) => candidate.id === item.id);
			if (!row) return;
			const { argument } = splitQuery(commit.query);
			const action = row.action;
			if (action.kind === 'heading') {
				editor.runCommand('heading.cycle', action.level);
			} else if (action.kind === 'run') {
				action.run(editor, argument ?? undefined);
			} else {
				// An empty line becomes the block; a line with text keeps it and gets the block below.
				// Copied because `blockNodeAt` takes a mutable path and the commit's is readonly.
				const empty = isBlankText(blockNodeAt(editor.document, [...commit.path])?.raw ?? '');
				// Awaited, so the block lands inside the pick's undo entry.
				await commit.insertMarkdown(action.build(argument).markdown, {
					placement: empty ? 'caret' : 'below'
				});
			}
		}
	};
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function catalogueRow(entry: InsertEntry): SlashRow {
	const { withArgument } = entry;
	return {
		id: entry.id,
		label: entry.label,
		icon: entry.icon,
		keywords: entry.keywords,
		takesArgument: withArgument !== undefined,
		action: {
			kind: 'insert',
			// A space with no word after it yet is no argument, so `withArgument` only sees a word.
			build: (argument) =>
				argument && withArgument ? withArgument(argument) : { markdown: entry.markdown }
		}
	};
}

function headingRow(level: number): SlashRow {
	return {
		id: `h${level}`,
		label: `Heading ${level}`,
		icon: 'heading',
		keywords: [`h${level}`, 'heading', 'title'],
		takesArgument: false,
		action: { kind: 'heading', level }
	};
}

function hostRow(entry: SlashCommandEntry): SlashRow {
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

function argumentDetail(row: SlashRow, argument: string): string | undefined {
	if (row.action.kind === 'insert') return row.action.build(argument).detail;
	return argument === '' ? undefined : argument;
}
