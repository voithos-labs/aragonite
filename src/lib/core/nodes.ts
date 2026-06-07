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

/**
 * Exhaustive manifest of every BlockKind. The `Record<BlockKind, true>` type
 * forces the compiler to flag a missing or stray member, so this is the single
 * union-derived source for "iterate over all kinds" — replacing hand-maintained
 * kind lists that pass vacuously when a member is forgotten.
 */
export const BLOCK_KIND_TABLE: Record<BlockKind, true> = {
	heading: true,
	setextHeading: true,
	paragraph: true,
	fencedCode: true,
	thematicBreak: true,
	indentedCode: true,
	htmlBlock: true,
	linkReferenceDefinition: true,
	tableCell: true,
	unrecognized: true,
	blockquote: true,
	list: true,
	listItem: true,
	table: true,
	tableRow: true
};

export const ALL_BLOCK_KINDS = Object.keys(BLOCK_KIND_TABLE) as BlockKind[];

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

/**
 * Maps each metadata-carrying BlockKind to its metadata interface. The five
 * kinds with no metadata (paragraph, indentedCode, htmlBlock, tableCell,
 * unrecognized) are intentionally absent — `metadataOf` rejects them.
 */
export interface BlockMetadataByKind {
	heading: HeadingMetadata;
	setextHeading: SetextHeadingMetadata;
	fencedCode: FencedCodeMetadata;
	thematicBreak: ThematicBreakMetadata;
	linkReferenceDefinition: LinkReferenceDefinitionMetadata;
	table: TableMetadata;
	tableRow: TableRowMetadata;
	blockquote: BlockquoteMetadata;
	list: ListMetadata;
	listItem: ListItemMetadata;
}

/**
 * Typed read of a node's metadata for a known kind. `CstNode.metadata` is the
 * `BlockMetadata` union and the flat-node model can't discriminate it by `kind`
 * (kind stays reassignable), so reading a specific kind's metadata needs a cast.
 * This is the one place that cast lives; the `kind` argument selects the return
 * interface. Pass the kind you've already established for `node`.
 */
export function metadataOf<K extends keyof BlockMetadataByKind>(
	node: CstNode,
	kind: K
): BlockMetadataByKind[K] {
	void kind;
	return node.metadata as BlockMetadataByKind[K];
}

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
	| 'entityReference'
	| 'unresolvedReference'
	| 'rawHtml';

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
	/** Discriminator for `unresolvedReference` nodes: which form they would have been. */
	refKind?: 'link' | 'image';
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
