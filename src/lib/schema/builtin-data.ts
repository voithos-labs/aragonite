/**
 * What a built-in block holds as its `data`, a published type per kind, read-only: a plugin reads it
 * once `block.is(builtin.blocks.heading)` narrows the block. A kind with no type here reads
 * undefined. The parser keeps its own facts per kind; these types say which of them a plugin gets,
 * and a row holds each against what the parser hands out (`builtin-data.types.test.ts`).
 */
import type { BlockKind } from '../core/nodes';

/** A `#` heading's data: its level, 1 to 6. */
export interface HeadingData {
	readonly level: number;
}

/** An underlined heading's data: level 1 under `=`, 2 under `-`. */
export interface SetextHeadingData {
	readonly level: 1 | 2;
}

/** A code fence's data: its info string, and whether a closing fence ends it. */
export interface FencedCodeData {
	/** The opening fence's character. */
	readonly fenceMarker: '`' | '~';
	/** How many of it the opening fence has; a closing fence needs at least as many. */
	readonly fenceLength: number;
	readonly info: string;
	readonly closed: boolean;
}

/** A thematic break's data: the character it repeats, `*`, `-` or `_`. */
export interface ThematicBreakData {
	readonly marker: string;
}

/** A link reference definition's data: its label as written (fold case and spaces to match a
 *  reference to it), and its URL and title with escapes resolved. */
export interface LinkReferenceDefinitionData {
	readonly label: string;
	readonly url?: string;
	readonly title?: string;
}

/** A list's data: whether its items are numbered. */
export interface ListData {
	readonly ordered: boolean;
}

/** A list item's data: its marker, and its checkbox when it's a task. */
export interface ListItemData {
	/** The marker as written, the gap after it included (`'- '`, `'10. '`). */
	readonly marker: string;
	readonly taskItem: boolean;
	readonly taskChecked: boolean;
	/** The checkbox as written, the gap after it included (`'[x] '`); null on an item with none. */
	readonly taskMarker: string | null;
}

/** A table's data: how many columns it has, and each column's alignment. */
export interface TableData {
	readonly columnCount: number;
	readonly alignments: readonly ('none' | 'left' | 'center' | 'right')[];
}

/** A table row's data: whether it's the header row. */
export interface TableRowData {
	readonly isHeader: boolean;
	/** A body row's cells past the header's count, as written; GFM shows none of them. Absent when
	 *  there are none. */
	readonly surplusCells?: readonly string[];
}

interface BuiltinDataByKind {
	heading: HeadingData;
	setextHeading: SetextHeadingData;
	fencedCode: FencedCodeData;
	thematicBreak: ThematicBreakData;
	linkReferenceDefinition: LinkReferenceDefinitionData;
	list: ListData;
	listItem: ListItemData;
	table: TableData;
	tableRow: TableRowData;
}

/** The data a built-in block of kind `K` reads as. */
export type BuiltinData<K extends BlockKind> = K extends keyof BuiltinDataByKind
	? BuiltinDataByKind[K]
	: undefined;
