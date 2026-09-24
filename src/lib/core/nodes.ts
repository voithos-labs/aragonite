/** CST node types for the GFM parser: mutable plain objects. Spec: docs/design/syntax-tree.md. */

import type { BytesView, NodeView } from './node-views';

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
 * The single union-derived source for "iterate over all kinds": `Record<BlockKind, true>` makes
 * the compiler flag a missing or stray member, where a hand-kept list passes vacuously.
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

declare const PluginKindBrand: unique symbol;
/**
 * A plugin-declared block kind, a plain string at runtime. The brand keeps `BlockKind` switches
 * exhaustive over built-ins while the registries key plugin kinds. Create via `declarePluginKind`.
 */
export type PluginBlockKind = string & { readonly [PluginKindBrand]: true };

export type AnyBlockKind = BlockKind | PluginBlockKind;

export function isBuiltinBlockKind(kind: AnyBlockKind): kind is BlockKind {
	return kind in BLOCK_KIND_TABLE;
}

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
	/** A body row's cells past the header's count, as written: GFM renders none of them, and the
	 *  row's rebuild writes them back after its rendered cells. Absent when there are none. */
	surplusCells?: readonly string[];
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

/** Metadata-less kinds are intentionally absent, so `metadataOf` rejects them. */
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
 * The one allowed metadata cast, for code a narrowed `BuiltinCstNode` member cannot reach: a
 * generic `K`, or a full `CstNode`, whose plugin member blocks `kind` narrowing. Prefer reading
 * `node.metadata` off a narrowed node. Pass the kind you have already established.
 */
export function metadataOf<K extends keyof BlockMetadataByKind>(
	node: CstNode,
	kind: K
): BlockMetadataByKind[K];
export function metadataOf<K extends keyof BlockMetadataByKind>(
	node: NodeView,
	kind: K
): BytesView<BlockMetadataByKind[K]>;
export function metadataOf<K extends keyof BlockMetadataByKind>(
	node: NodeView,
	kind: K
): BlockMetadataByKind[K] {
	void kind;
	return node.metadata as BlockMetadataByKind[K];
}

/**
 * `BlockMetadata` is closed over the built-ins, so bridging a plugin's shape needs a cast and
 * this pair is the one place it lives. Keep the stored shape primitive-valued: the one-level
 * undo clone (G1.6) shallow-copies metadata.
 */
export function setPluginMetadata<T>(node: CstNode, data: T): void {
	node.metadata = data as unknown as BlockMetadata;
}

export function getPluginMetadata<T>(node: NodeView): T | undefined {
	return node.metadata as unknown as T | undefined;
}

/**
 * Null for any non-heading node. The one heading-metadata read on the authoring barrel:
 * `metadata.level` narrows only past `isBuiltinBlockNode`, which the barrel does not export.
 */
export function headingLevel(node: NodeView): number | null {
	if (node.kind === 'heading') return metadataOf(node, 'heading').level;
	if (node.kind === 'setextHeading') return metadataOf(node, 'setextHeading').level;
	return null;
}

// ── Node Types ──────────────────────────────────────────────────────────────

/** `ownerEpoch` is structural-sharing bookkeeping, not round-trip bytes. */
interface BlockNodeBase {
	leadingTrivia: string;
	raw: string;
	ownerEpoch?: number;
}

/**
 * A leaf never has `children` or the container fields (G1.5), so the leaf members type them
 * `undefined` and the union rejects a leaf that grew a child at compile time.
 */
interface LeafBlockNodeBase extends BlockNodeBase {
	children?: undefined;
	innerPrefix?: undefined;
	innerSuffix?: undefined;
	childIds?: undefined;
	childSpans?: undefined;
}

/**
 * A container may be briefly childless mid-edit (the leaf rule runs one way, G1.5), so every
 * structural field stays optional. `childIds` mirrors `children` for keyed rendering;
 * `childSpans` records where each child's bytes sit in `raw` (`schema/child-spans.ts`).
 */
interface ContainerBlockNodeBase extends BlockNodeBase {
	children?: CstNode[];
	innerPrefix?: string;
	innerSuffix?: string;
	childIds?: string[];
	childSpans?: Uint32Array;
}

export interface ParagraphNode extends LeafBlockNodeBase {
	kind: 'paragraph';
	metadata?: undefined;
}
export interface HeadingNode extends LeafBlockNodeBase {
	kind: 'heading';
	metadata: HeadingMetadata;
}
export interface SetextHeadingNode extends LeafBlockNodeBase {
	kind: 'setextHeading';
	metadata: SetextHeadingMetadata;
}
export interface FencedCodeNode extends LeafBlockNodeBase {
	kind: 'fencedCode';
	metadata: FencedCodeMetadata;
}
export interface ThematicBreakNode extends LeafBlockNodeBase {
	kind: 'thematicBreak';
	metadata: ThematicBreakMetadata;
}
export interface IndentedCodeNode extends LeafBlockNodeBase {
	kind: 'indentedCode';
	metadata?: undefined;
}
export interface HtmlBlockNode extends LeafBlockNodeBase {
	kind: 'htmlBlock';
	metadata?: undefined;
}
export interface LinkReferenceDefinitionNode extends LeafBlockNodeBase {
	kind: 'linkReferenceDefinition';
	metadata: LinkReferenceDefinitionMetadata;
}
export interface TableCellNode extends LeafBlockNodeBase {
	kind: 'tableCell';
	metadata?: undefined;
}
export interface UnrecognizedNode extends LeafBlockNodeBase {
	kind: 'unrecognized';
	metadata?: undefined;
}

export interface BlockquoteNode extends ContainerBlockNodeBase {
	kind: 'blockquote';
	metadata: BlockquoteMetadata;
}
export interface ListNode extends ContainerBlockNodeBase {
	kind: 'list';
	metadata: ListMetadata;
}
export interface ListItemNode extends ContainerBlockNodeBase {
	kind: 'listItem';
	metadata: ListItemMetadata;
}
export interface TableNode extends ContainerBlockNodeBase {
	kind: 'table';
	metadata: TableMetadata;
}
export interface TableRowNode extends ContainerBlockNodeBase {
	kind: 'tableRow';
	metadata: TableRowMetadata;
}

/**
 * A branded-string kind, so `switch (node.kind)` cannot narrow this member: narrow past it with
 * `isBuiltinBlockNode` first. A plugin block may be a leaf or a container, so the structural
 * fields stay optional.
 */
export interface PluginBlockNode extends BlockNodeBase {
	kind: PluginBlockKind;
	metadata?: BlockMetadata;
	children?: CstNode[];
	innerPrefix?: string;
	innerSuffix?: string;
	childIds?: string[];
	childSpans?: Uint32Array;
}

/** A genuine discriminated union: `switch (node.kind)` narrows `node.metadata` with no cast. */
export type BuiltinCstNode =
	| ParagraphNode
	| HeadingNode
	| SetextHeadingNode
	| FencedCodeNode
	| ThematicBreakNode
	| IndentedCodeNode
	| HtmlBlockNode
	| LinkReferenceDefinitionNode
	| TableCellNode
	| UnrecognizedNode
	| BlockquoteNode
	| ListNode
	| ListItemNode
	| TableNode
	| TableRowNode;

/**
 * The open `PluginBlockNode` member has no literal kind, so `kind` checks on the full union do
 * not narrow: go through `isBuiltinBlockNode` first. Common fields (`raw`, `leadingTrivia`,
 * `kind`) exist on every member and read without narrowing.
 */
export type CstNode = BuiltinCstNode | PluginBlockNode;

/**
 * The one way into the `switch (node.kind)` narrowing the plugin member blocks. Overloaded for
 * views, so code that narrows a `NodeView` reads each member's metadata with no `metadataOf`.
 */
export function isBuiltinBlockNode(node: CstNode): node is BuiltinCstNode;
export function isBuiltinBlockNode(node: NodeView): node is BytesView<BuiltinCstNode>;
export function isBuiltinBlockNode(node: CstNode | NodeView): boolean {
	return isBuiltinBlockKind(node.kind);
}

/**
 * The one place the cast from a runtime kind string to `CstNode` lives. The spread returns a
 * fresh object, so passing a view creates a copy rather than stripping its read-only-ness, which
 * is why the view-cast lint allows this file (G4.13). Fields are not checked against the kind, so
 * a node of a metadata-carrying kind can be created without metadata (a temporary re-parse does
 * this) and its `metadata` must not be read before the re-parse.
 */
export function makeBlockNode(fields: {
	kind: AnyBlockKind;
	leadingTrivia: string;
	raw: string;
	metadata?: BlockMetadata;
	children?: CstNode[];
	innerPrefix?: string;
	innerSuffix?: string;
	childIds?: string[];
	ownerEpoch?: number;
}): CstNode {
	return { ...fields } as CstNode;
}

export interface Document {
	kind: 'document';
	prefix: string;
	children: CstNode[];
	suffix: string;
	/** The root's parallel id array, when a caller keeps one here: the editor's own live ids are
	 *  editor state, but the splice operations maintain whatever array the parent carries. */
	childIds?: string[];
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

declare const InlineKindBrand: unique symbol;
/** The inline sibling of `PluginBlockKind`; create via `declarePluginInlineKind`. */
export type PluginInlineKind = string & { readonly [InlineKindBrand]: true };

export type AnyInlineKind = InlineNodeKind | PluginInlineKind;

export const INLINE_KIND_TABLE: Record<InlineNodeKind, true> = {
	text: true,
	emphasis: true,
	strong: true,
	strikethrough: true,
	inlineCode: true,
	link: true,
	image: true,
	autolink: true,
	hardLineBreak: true,
	escape: true,
	entityReference: true,
	unresolvedReference: true,
	rawHtml: true
};

export function isBuiltinInlineKind(kind: AnyInlineKind): kind is InlineNodeKind {
	return kind in INLINE_KIND_TABLE;
}

/** start/end are byte offsets into the parent block's raw, including markers. Optional keys are
 *  omitted, never set to `undefined`, so a serializer can tell "no title" from "empty title". */
export interface InlineNode {
	kind: AnyInlineKind;
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
	/** Pan/zoom inside the `|WxH` frame, read from a `@X,Y[,Z]` tail on the hint. */
	crop?: ImageCrop;
	/** Discriminator for `unresolvedReference` nodes: which form they would have been. */
	refKind?: 'link' | 'image';
	/**
	 * Set by the scan when a plugin handler claimed these bytes, derived per scan and never
	 * persisted. Write paths read it to re-serialize in the claiming syntax, not built-in GFM.
	 */
	syntaxClaim?: InlineSyntaxClaim;
}

/**
 * How an image sits inside its `|WxH` frame: the image point (`x`%, `y`%) pinned to the same
 * point of the frame, at `z` times the smallest scale that fills it. `{50, 50, 1}` is a plain
 * centred cover fit; absent, the frame stretches the image the way `<img width height>` does.
 */
export interface ImageCrop {
	x: number;
	y: number;
	z: number;
}

export interface ImageFields {
	alt: string;
	url: string;
	title?: string;
	width?: number;
	height?: number;
	/** Needs both dimensions: a crop is a window into a fixed frame. */
	crop?: ImageCrop;
	/**
	 * Reference-style images only (`![alt][label]`). When set, the serializer emits the reference
	 * form and writes no url/title: those live in the LRD, and inlining them would orphan it.
	 */
	label?: string;
}

/**
 * Re-serializes an image a plugin handler created over its own bytes: `source` in, its
 * replacement in the plugin's syntax out, or `null` to decline the edit rather than rewrite the
 * bytes as GFM.
 */
export type ImageSyntaxRewriter = (source: string, fields: ImageFields) => string | null;

/** What the scan records on a node a plugin inline handler claimed. */
export interface InlineSyntaxClaim {
	/** The claiming handler's prefix: its bare trigger, or its multi-character prefix. */
	prefix: string;
	rewriteImage?: ImageSyntaxRewriter;
}
