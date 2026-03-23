export { parse } from './core/parser';
export { serialize } from './core/serializer';
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
	ListItemMetadata
} from './core/nodes';

// ── Editor runtime ──────────────────────────────────────────────────────────

export { EDITOR_ACTIONS_KEY } from './editor-types';
export type { EditorActions, BlockComponent, UndoManager, UndoEntry } from './editor-types';
export { cloneDocument, serializeMutable, assignIds, generateBlockId } from './mutable-tree';
export { splitNode, mergeWithPrevious, deleteNode, updateNodeContent } from './tree-operations';
export { createUndoManager } from './undo-manager';
