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
