export { parse } from './core/parser';
export { serialize } from './core/serializer';
export {
	Document,
	CstNode,
	LeafBlock,
	ContainerBlock,
	Heading,
	SetextHeading,
	Paragraph,
	FencedCode,
	ThematicBreak,
	IndentedCode,
	HtmlBlock,
	LinkReferenceDefinition,
	Table,
	UnrecognizedBlock,
	Blockquote,
	List,
	ListItem
} from './core/nodes';
export type {
	BlockKind,
	LeafBlockKind,
	ContainerBlockKind,
	HeadingMetadata,
	SetextHeadingMetadata,
	FencedCodeMetadata,
	ThematicBreakMetadata,
	LinkReferenceDefinitionMetadata,
	TableMetadata,
	BlockquoteMetadata,
	ListMetadata,
	ListItemMetadata
} from './core/nodes';

// ── Editor runtime ──────────────────────────────────────────────────────────

export { EDITOR_ACTIONS_KEY } from './editor-types';
export type {
	EditorActions,
	BlockComponent,
	UndoManager,
	UndoEntry,
	MutableNode,
	MutableDocument
} from './editor-types';
export {
	toMutable,
	cloneDocument,
	serializeMutable,
	assignIds,
	generateBlockId
} from './mutable-tree';
export { splitNode, mergeWithPrevious, deleteNode, updateNodeContent } from './tree-operations';
export { createUndoManager } from './undo-manager';
