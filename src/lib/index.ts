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

// ── Events surface (0.5.4) ─────────────────────────────────────────────────

export type {
	EditorEvents,
	EditEvent,
	EditorEventMap,
	SelectionChangeEvent
} from './events/editor-events';

// ── Container state — intentionally internal at 0.5.1 ─────────────────────
//
// BlockListState, createBlockListState, registerBlockListState,
// getStateForNode, createStandardNestedActions, and the NestedActions types
// live in `components/blocks/container-state/` but are NOT exported here.
//
// Decision rationale: the roadmap scopes 0.5.1 as the foundation for 1.2's
// plugin system. Locking export names at 0.5.1 — before a real plugin author
// exists to shape requirements — risks premature naming decisions a later
// consumer would force us to break. The 0.5.1 done-gate is satisfied
// explicitly: no new container-state exports at 0.5.1; full plugin surface
// locked at 1.2 when the first external consumer is real.

// ── Debug engine — intentionally internal at 0.5.3 ────────────────────────
//
// dumpTree, dumpSelection, dumpUndoStack, dumpInlineTree, dumpOperationsLog,
// and createOperationsLog live in `debug/` but are NOT exported here.
//
// Decision rationale: same shape as the 0.5.1 container-state non-export
// above. The inspect surface is consumed by `/test/editor`'s debug panel
// and by tests, not by external library consumers. Locking names at 0.5.3
// risks premature naming the 1.2 plugin API would force us to break.
