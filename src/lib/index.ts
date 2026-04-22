export { parse } from './core/parser';
export { serialize } from './core/serializer';
export { parseInline, getContentRange, isProseKind } from './core/inline';
export type { ContentRange } from './core/inline';
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

export { LIST_CONTEXT_KEY } from './contracts';
export type { BlockComponent, UndoManager, UndoEntry, ListContext } from './contracts';
export { cloneDocument } from './tree-operations/clone';
export { assignIds, generateBlockId } from './tree-operations/block-id';
export { splitNode, mergeWithPrevious, deleteNode, updateNodeContent } from './tree-operations';
export { createUndoManager } from './undo-manager';

// ── Events surface ─────────────────────────────────────────────────────────

export type {
	EditorEvents,
	EditEvent,
	EditorEventMap,
	SelectionChangeEvent
} from './events/editor-events';

// Internal-only (no external export): container-state, debug engine, commit
// primitives, selection-write APIs. These surfaces will be shaped against
// 1.2's plugin requirements; the EditorEvents type above is the only
// read-only subscription seam exposed pre-1.2.
