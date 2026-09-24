/**
 * The `/` list: the insert catalogue, three heading rows and the host's own entries, read fresh
 * from the editor on every keystroke. A pick removes the `/query` bytes first (its `insert` is
 * empty), then `onCommit` does the row's work through the editor's own entry points.
 */

import type {
	DocumentView,
	EditorContext,
	InlineMenuSource,
	InsertEntry,
	MenuIconName
} from '$lib/plugin';
import { codeArgument, tableArgument, type ParsedArgument } from './arguments';
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

type SlashAction =
	| { kind: 'insert'; build: (argument: string | null) => ParsedArgument }
	| { kind: 'heading'; level: number }
	| { kind: 'run'; run: (editor: EditorContext, argument?: string) => void };

interface SlashRow extends FilterableEntry {
	id: string;
	icon?: MenuIconName;
	action: SlashAction;
}

const HEADING_LEVELS = [1, 2, 3];

/** The source one editor lists; `options` are read per call, so a host passing new ones sees them. */
export function createSlashSource(
	editor: EditorContext,
	getOptions: () => SlashCommandsOptions
): InlineMenuSource {
	function rows(): SlashRow[] {
		const { entries = [], exclude = [] } = getOptions();
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
		onCommit: async (item, range) => {
			const row = rows().find((candidate) => candidate.id === item.id);
			if (!row) return;
			const { argument } = splitQuery(range.query);
			const action = row.action;
			if (action.kind === 'heading') {
				editor.runCommand('heading.cycle', action.level);
			} else if (action.kind === 'run') {
				action.run(editor, argument ?? undefined);
			} else {
				// An empty line becomes the block; a line with text keeps it and gets the block below.
				const empty = leafRaw(editor.document, range.path).trim() === '';
				// Awaited, so the block lands inside the pick's undo entry.
				await editor.insertMarkdown(action.build(argument).markdown, {
					placement: empty ? 'caret' : 'below'
				});
			}
		}
	};
}

// ── Rows ─────────────────────────────────────────────────────────────────────

const ARGUMENT_BUILDERS: Record<string, (argument: string | null) => ParsedArgument> = {
	code: codeArgument,
	table: tableArgument
};

function catalogueRow(entry: InsertEntry): SlashRow {
	const build = ARGUMENT_BUILDERS[entry.id];
	return {
		id: entry.id,
		label: entry.label,
		icon: entry.icon,
		keywords: entry.keywords,
		takesArgument: build !== undefined,
		action: { kind: 'insert', build: build ?? (() => ({ markdown: entry.markdown })) }
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

/** The raw of the block at `path`, read through the live document on every call. */
function leafRaw(doc: DocumentView, path: readonly number[]): string {
	let node: { readonly children?: readonly unknown[]; readonly raw?: string } | undefined = doc;
	for (const index of path) node = node?.children?.[index] as typeof node;
	return node?.raw ?? '';
}
