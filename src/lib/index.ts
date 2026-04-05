export { parse } from './core/parser';
export { serialize } from './core/serializer';
export { parseInline, getContentRange, isProseKind } from './core/inline-parser';
export type { ContentRange } from './core/inline-parser';
export type {
	BlockKind,
	LeafBlockKind,
	ContainerBlockKind,
	CstNode,
	Document,
	BlockMetadata,
	HeadingMetadata,
	SetextHeadingMetadata,
	FencedCodeMetadata,
	ThematicBreakMetadata,
	LinkReferenceDefinitionMetadata,
	TableMetadata,
	BlockquoteMetadata,
	ListMetadata,
	ListItemMetadata,
	InlineNodeKind,
	InlineNode
} from './core/nodes';

// ── Editor runtime ──────────────────────────────────────────────────────────

export { EDITOR_ACTIONS_KEY, LIST_CONTEXT_KEY } from './editor-types';
export type {
	EditorActions,
	BlockComponent,
	UndoManager,
	UndoEntry,
	ListContext
} from './editor-types';
export { cloneDocument, serializeMutable, assignIds, generateBlockId } from './mutable-tree';
export { splitNode, mergeWithPrevious, deleteNode, updateNodeContent } from './tree-operations';
export { createUndoManager } from './undo-manager';
