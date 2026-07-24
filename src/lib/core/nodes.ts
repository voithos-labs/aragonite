/**
 * CST node types for the GFM parser. Mutable plain objects — no class
 * hierarchy. See docs/design/syntax-tree.md for the design spec.
 */

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

declare const PluginKindBrand: unique symbol;
/**
 * A plugin-declared block kind. Runtime value is a plain string; the brand
 * keeps `BlockKind` switches exhaustive over built-ins while letting the
 * schema registries key plugin kinds. Create via `declarePluginKind`.
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
 * Maps each metadata-carrying BlockKind to its metadata interface. Kinds with
 * no metadata are intentionally absent — `metadataOf` rejects them.
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
 * Typed read of a node's metadata for a known kind. Where the node is already a
 * narrowed `BuiltinCstNode` arm, `node.metadata` reads with the right type
 * directly — prefer that. This funnel stays for the un-narrowed contexts: a
 * generic `K`, or a full `CstNode` whose branded plugin arm blocks `kind`
 * narrowing. Its body carries the one sanctioned metadata cast; the `kind`
 * argument selects the return interface. Pass the kind you've already
 * established for `node`. A readonly view yields a readonly metadata view —
 * reads stay legal, writes don't.
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
 * Store/read a plugin kind's own metadata shape. `BlockMetadata` is a closed
 * union over the built-in kinds with no plugin arm, so bridging a plugin's
 * shape needs a cast; this accessor pair is the one place it lives, mirroring
 * `metadataOf` for built-ins. Keep the stored shape primitive-valued — the
 * one-level undo clone (invariant G1.6) shallow-copies metadata.
 */
export function setPluginMetadata<T>(node: CstNode, data: T): void {
	node.metadata = data as unknown as BlockMetadata;
}

export function getPluginMetadata<T>(node: NodeView): T | undefined {
	return node.metadata as unknown as T | undefined;
}

/**
 * The level of an ATX or setext heading, or null for any other node. The one
 * heading-metadata read the authoring barrel exposes: `metadata.level` narrows
 * only past `isBuiltinBlockNode` (kept off the barrel), so an outline plugin has
 * no other typed path to a heading's depth. Sibling to `getContentRange` in the
 * marker-reading family.
 */
export function headingLevel(node: NodeView): number | null {
	if (node.kind === 'heading') return metadataOf(node, 'heading').level;
	if (node.kind === 'setextHeading') return metadataOf(node, 'setextHeading').level;
	return null;
}

// ── Node Types ──────────────────────────────────────────────────────────────

/**
 * Fields every block node carries. `ownerEpoch` is editor-level sharing
 * bookkeeping for structural-sharing undo — not round-trip bytes.
 */
interface BlockNodeBase {
	leadingTrivia: string;
	raw: string;
	ownerEpoch?: number;
}

/**
 * Leaf category. G1.5 forbids `children` and the container structural fields on
 * non-containers, so the arms pin them `undefined` — the union then rejects a
 * leaf that grew a child at the type level, and a narrowed leaf reads them away.
 */
interface LeafBlockNodeBase extends BlockNodeBase {
	children?: undefined;
	innerPrefix?: undefined;
	innerSuffix?: undefined;
	childIds?: undefined;
}

/**
 * Container category. G1.5 is one-directional — a container may be transiently
 * childless mid-edit — so every structural field stays optional; the arms never
 * require them. `childIds` mirrors `children` for keyed rendering; undo restores
 * both together.
 */
interface ContainerBlockNodeBase extends BlockNodeBase {
	children?: CstNode[];
	innerPrefix?: string;
	innerSuffix?: string;
	childIds?: string[];
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
 * A block minted by a plugin kind. The kind is a branded string, not a literal,
 * so this arm is NOT discriminable by `switch (node.kind)` — narrow past it with
 * `isBuiltinBlockNode` first. `metadata` rides the shared slot via the cast
 * accessors (`get`/`setPluginMetadata`); a plugin block may be a leaf or a
 * container, so the structural fields stay optional.
 */
export interface PluginBlockNode extends BlockNodeBase {
	kind: PluginBlockKind;
	metadata?: BlockMetadata;
	children?: CstNode[];
	innerPrefix?: string;
	innerSuffix?: string;
	childIds?: string[];
}

/**
 * The built-in block arms — a genuine discriminated union. `switch (node.kind)`
 * on a `BuiltinCstNode` narrows to the exact arm, so `node.metadata` reads as
 * that kind's metadata with no cast.
 */
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
 * A CST block node. The built-in arms discriminate on `kind`; the open
 * `PluginBlockNode` arm does not (branded-string kind), so full-union `kind`
 * checks don't narrow — reach the discriminated world through
 * `isBuiltinBlockNode`. Common fields (`raw`, `leadingTrivia`, `kind`) project
 * across every arm and read without narrowing.
 */
export type CstNode = BuiltinCstNode | PluginBlockNode;

/**
 * Narrow a node to the discriminated built-in union — the door to
 * `switch (node.kind)` metadata narrowing that the branded plugin arm otherwise
 * blocks. Mirrored for views: `BytesView<BuiltinCstNode>` discriminates too, so a
 * reader that narrows a `NodeView` reads each arm's metadata with no `metadataOf`.
 */
export function isBuiltinBlockNode(node: CstNode): node is BuiltinCstNode;
export function isBuiltinBlockNode(node: NodeView): node is BytesView<BuiltinCstNode>;
export function isBuiltinBlockNode(node: CstNode | NodeView): boolean {
	return isBuiltinBlockKind(node.kind);
}

/**
 * Mint a block node from a runtime `kind`. A non-literal kind matches no arm, so
 * the return needs a cast; this funnel is the ONE place it lives. It is a
 * construction door, distinct from the view→mutable strip door (unshare/clone):
 * the spread returns a FRESH object, so passing a view here mints a copy rather
 * than stripping the view's readonly-ness — the funnel cannot open a G1.9 hazard,
 * which is why G4.13 sanctions this file. Field params are mutable by contract.
 *
 * The fields are not checked against the arm, so this can mint a metadata-less
 * node of a metadata-carrying kind — a transient re-parse probe does exactly that.
 * Such a node's `metadata` must not be read before it is re-parsed or discarded.
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
/**
 * A plugin-declared inline kind. Runtime value is a plain string; the brand
 * keeps `InlineNodeKind` switches exhaustive over built-ins while letting the
 * schema registries key plugin kinds.
 */
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

/** start/end are byte offsets into the parent block's raw, including markers. */
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
	/** Discriminator for `unresolvedReference` nodes: which form they would have been. */
	refKind?: 'link' | 'image';
}
