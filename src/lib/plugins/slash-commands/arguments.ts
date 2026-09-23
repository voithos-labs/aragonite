/**
 * The two built-in arguments a `/` row takes: a code block's language and a table's size. A
 * malformed argument falls back to the default and says how to write it, so Enter always inserts.
 */

export interface ParsedArgument {
	markdown: string;
	/** The row's dim text: what the argument was read as, plus a hint when it was not understood. */
	detail?: string;
}

export interface TableSize {
	columns: number;
	/** The header row counts, so the default two-row table is a header and one empty row. */
	rows: number;
}

const DEFAULT_TABLE: TableSize = { columns: 2, rows: 2 };
const MAX_COLUMNS = 20;
const MAX_ROWS = 100;
const TABLE_HINT = 'columns×rows, like 3x4';

/** `3x4` (or `3X4`, `3×4`) is three columns and four rows; null for anything else. */
export function parseTableSize(argument: string): TableSize | null {
	const match = /^(\d+)[xX×](\d+)$/.exec(argument);
	if (!match) return null;
	const size = { columns: Number(match[1]), rows: Number(match[2]) };
	const fits =
		size.columns >= 1 && size.columns <= MAX_COLUMNS && size.rows >= 2 && size.rows <= MAX_ROWS;
	return fits ? size : null;
}

/** The same header, delimiter and empty-cell spelling the insert menu's own table uses. */
export function tableMarkdown({ columns, rows }: TableSize): string {
	const line = (cell: string) => `|${` ${cell} |`.repeat(columns)}\n`;
	return line('Column') + line('---') + line('').repeat(rows - 1);
}

export function tableArgument(argument: string | null): ParsedArgument {
	if (!argument) return { markdown: tableMarkdown(DEFAULT_TABLE) };
	const size = parseTableSize(argument);
	if (!size) {
		return { markdown: tableMarkdown(DEFAULT_TABLE), detail: `2×2 · ${TABLE_HINT}` };
	}
	return { markdown: tableMarkdown(size), detail: `${size.columns}×${size.rows}` };
}

/** A backtick fence's info string may hold no backtick, so one there falls back to no language. */
export function codeArgument(argument: string | null): ParsedArgument {
	if (!argument) return { markdown: '```\n\n```\n' };
	if (argument.includes('`')) {
		return { markdown: '```\n\n```\n', detail: 'no language · a language has no backtick' };
	}
	return { markdown: `\`\`\`${argument}\n\n\`\`\`\n`, detail: argument };
}
