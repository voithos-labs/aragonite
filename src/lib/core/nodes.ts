/**
 * CST node types for the GFM parser. Mutable plain objects — no class
 * hierarchy. See docs/design/editor/syntax-tree.md for the design spec.
 */

// ── Node Kinds ──────────────────────────────────────────────────────────────

export type LeafBlockKind =
	| 'heading'
	| 'setextHeading'
	| 'paragraph'
	| 'fencedCode'
	| 'thematicBreak'
	| 'indentedCode'
	| 'htmlBlock'
	| 'linkReferenceDefinition'
	| 'tableCell'
	| 'unrecognized';

export type ContainerBlockKind = 'blockquote' | 'list' | 'listItem' | 'table' | 'tableRow';

export type BlockKind = LeafBlockKind | ContainerBlockKind;

// ── Metadata ────────────────────────────────────────────────────────────────

export interface HeadingMetadata {
	level: number;
}

export interface SetextHeadingMetadata {
	level: 1 | 2;
}

export interface FencedCodeMetadata {
	fenceMarker: '`' | '~';
	fenceLength: number;
	info: string;
	closed: boolean;
}

export interface ThematicBreakMetadata {
	marker: string;
}

export interface LinkReferenceDefinitionMetadata {
	label: string;
	url?: string;
	title?: string;
}

export type TableAlignment = 'none' | 'left' | 'center' | 'right';

export interface TableMetadata {
	columnCount: number;
	alignments: TableAlignment[];
}

export interface TableRowMetadata {
	isHeader: boolean;
}

export interface BlockquoteMetadata {
	quoteDepth: number;
}

export interface ListMetadata {
	ordered: boolean;
}

export interface ListItemMetadata {
	marker: string;
	taskItem: boolean;
	taskChecked: boolean;
	taskMarker: string | null;
}

export type BlockMetadata =
	| HeadingMetadata
	| SetextHeadingMetadata
	| FencedCodeMetadata
	| ThematicBreakMetadata
	| LinkReferenceDefinitionMetadata
	| TableMetadata
	| TableRowMetadata
	| BlockquoteMetadata
	| ListMetadata
	| ListItemMetadata;

// ── Inline Node Types ──────────────────────────────────────────────────────

export type InlineNodeKind =
	| 'text'
	| 'emphasis'
	| 'strong'
	| 'strikethrough'
	| 'inlineCode'
	| 'link'
	| 'image'
	| 'autolink'
	| 'hardLineBreak'
	| 'escape'
	| 'entityReference';

/** start/end are byte offsets into the parent block's raw, including markers. */
export interface InlineNode {
	kind: InlineNodeKind;
	start: number;
	end: number;
	text?: string;
	children?: InlineNode[];
	url?: string;
	title?: string;
	label?: string;
	alt?: string;
	decoded?: string;
	width?: number;
	height?: number;
}

// ── Node Types ──────────────────────────────────────────────────────────────

export interface CstNode {
	kind: BlockKind;
	leadingTrivia: string;
	raw: string;
	metadata?: BlockMetadata;
	innerPrefix?: string;
	children?: CstNode[];
	innerSuffix?: string;
	/** Per-child IDs for keyed rendering. Cloned with the node so undo restores them alongside `children`. */
	childIds?: string[];
	/** Rendering cache for prose blocks — derived from raw, never re-serialized. */
	inlineContent?: InlineNode[];
}

export interface Document {
	kind: 'document';
	prefix: string;
	children: CstNode[];
	suffix: string;
}
