/**
 * CST node type hierarchy for the GFM block-level parser.
 * See docs/editor/syntax-tree.md for the design spec.
 */

// ── Node Kinds ──────────────────────────────────────────────────────────────

export type LeafBlockKind =
	| 'heading'
	| 'setextHeading'
	| 'paragraph'
	| 'fencedCode'
	| 'thematicBreak'
	| 'unrecognized';

export type ContainerBlockKind = 'blockquote' | 'list' | 'listItem';

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
}

// ── Base Classes ────────────────────────────────────────────────────────────

export abstract class CstNode {
	abstract readonly kind: BlockKind | 'document';
	readonly leadingTrivia: string;
	readonly raw: string;

	constructor(leadingTrivia: string, raw: string) {
		this.leadingTrivia = leadingTrivia;
		this.raw = raw;
	}
}

export abstract class LeafBlock extends CstNode {
	abstract readonly kind: LeafBlockKind;
}

export abstract class ContainerBlock extends CstNode {
	abstract readonly kind: ContainerBlockKind;
	readonly innerPrefix: string;
	readonly children: CstNode[];
	readonly innerSuffix: string;

	constructor(
		leadingTrivia: string,
		raw: string,
		innerPrefix: string,
		children: CstNode[],
		innerSuffix: string
	) {
		super(leadingTrivia, raw);
		this.innerPrefix = innerPrefix;
		this.children = children;
		this.innerSuffix = innerSuffix;
	}
}

// ── Document ────────────────────────────────────────────────────────────────

export class Document {
	readonly kind = 'document' as const;
	readonly prefix: string;
	readonly children: CstNode[];
	readonly suffix: string;

	constructor(prefix: string, children: CstNode[], suffix: string) {
		this.prefix = prefix;
		this.children = children;
		this.suffix = suffix;
	}
}

// ── Leaf Blocks ─────────────────────────────────────────────────────────────

export class Heading extends LeafBlock {
	readonly kind = 'heading' as const;
	readonly metadata: HeadingMetadata;

	constructor(leadingTrivia: string, raw: string, metadata: HeadingMetadata) {
		super(leadingTrivia, raw);
		this.metadata = metadata;
	}
}

export class SetextHeading extends LeafBlock {
	readonly kind = 'setextHeading' as const;
	readonly metadata: SetextHeadingMetadata;

	constructor(leadingTrivia: string, raw: string, metadata: SetextHeadingMetadata) {
		super(leadingTrivia, raw);
		this.metadata = metadata;
	}
}

export class Paragraph extends LeafBlock {
	readonly kind = 'paragraph' as const;

	constructor(leadingTrivia: string, raw: string) {
		super(leadingTrivia, raw);
	}
}

export class FencedCode extends LeafBlock {
	readonly kind = 'fencedCode' as const;
	readonly metadata: FencedCodeMetadata;

	constructor(leadingTrivia: string, raw: string, metadata: FencedCodeMetadata) {
		super(leadingTrivia, raw);
		this.metadata = metadata;
	}
}

export class ThematicBreak extends LeafBlock {
	readonly kind = 'thematicBreak' as const;
	readonly metadata: ThematicBreakMetadata;

	constructor(leadingTrivia: string, raw: string, metadata: ThematicBreakMetadata) {
		super(leadingTrivia, raw);
		this.metadata = metadata;
	}
}

export class UnrecognizedBlock extends LeafBlock {
	readonly kind = 'unrecognized' as const;

	constructor(leadingTrivia: string, raw: string) {
		super(leadingTrivia, raw);
	}
}

// ── Container Blocks ────────────────────────────────────────────────────────

export class Blockquote extends ContainerBlock {
	readonly kind = 'blockquote' as const;
	readonly metadata: BlockquoteMetadata;

	constructor(
		leadingTrivia: string,
		raw: string,
		innerPrefix: string,
		children: CstNode[],
		innerSuffix: string,
		metadata: BlockquoteMetadata
	) {
		super(leadingTrivia, raw, innerPrefix, children, innerSuffix);
		this.metadata = metadata;
	}
}

export class List extends ContainerBlock {
	readonly kind = 'list' as const;
	declare readonly children: ListItem[];
	readonly metadata: ListMetadata;

	constructor(
		leadingTrivia: string,
		raw: string,
		innerPrefix: string,
		children: ListItem[],
		innerSuffix: string,
		metadata: ListMetadata
	) {
		super(leadingTrivia, raw, innerPrefix, children, innerSuffix);
		this.metadata = metadata;
	}
}

export class ListItem extends ContainerBlock {
	readonly kind = 'listItem' as const;
	readonly metadata: ListItemMetadata;

	constructor(
		leadingTrivia: string,
		raw: string,
		innerPrefix: string,
		children: CstNode[],
		innerSuffix: string,
		metadata: ListItemMetadata
	) {
		super(leadingTrivia, raw, innerPrefix, children, innerSuffix);
		this.metadata = metadata;
	}
}
