// Public, supported surface of the editor module. Adding an export here is
// non-breaking; removing one is breaking — keep this minimal and grow on demand.
// Anything not re-exported here is internal and may change without notice.

// ── Component ────────────────────────────────────────────────────────────────

export { default as Editor } from './components/Editor.svelte';

export type { EditorProps, EditorInstance } from './editor-props';

// The consumer diagnostics door — `getDiagnostics()` returns EditorDiagnostics;
// InteractionTraceEntry is what its `traceSnapshot()` yields.
export type { EditorDiagnostics, InteractionTraceEntry } from './editor-props';

export type { BlockComponent } from './block-component';
export type { ResolveImageUrl, ResolveLinkUrl } from './editor-keys';
export type { ImageLoadPolicy } from './core/inline-render';
export type { PresentationMode } from './presentation-mode';
export type { SearchState, SearchOptions } from './reactivity/search-state.svelte';
export type { Match } from './search/document-scan';

// ── Plugins ────────────────────────────────────────────────────────────────────

// installPlugins for editor-less `parse()` pipelines that need the grammar live
// without mounting <Editor>; EditorPlugin types the `plugins` prop.
export { installPlugins } from './schema/plugin-install';
export type { EditorPlugin, EditorPluginEntry } from './schema/plugin-install';

// ── Selection + keybinding public types ────────────────────────────────────────

export type { EditorSelection, SelectionPoint } from './selection/primitives';
export type { KeybindingOverride } from './schema/keybinding-overrides';
export type { CommandId } from './schema/commands';

// ── CST utilities ────────────────────────────────────────────────────────────

export { parse } from './core/parser';
export { serialize } from './core/serializer';
export { parseInline, getContentRange, isProseKind } from './core/inline';
export type { ContentRange } from './core/inline';

// ── Node & inline types ──────────────────────────────────────────────────────

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

// The bytes-readonly views a consumer reads the CST through (EditorContext.document,
// BlockComponentProps, DecorationSource.provide). Mutation goes through commits.
export type { NodeView, DocumentView } from './core/node-views';

// ── Events ───────────────────────────────────────────────────────────────────

export type {
	EditorEvents,
	EditEvent,
	EditorEventMap,
	EditorError,
	SelectionChangeEvent
} from './editor-events';

// ── Decorations ──────────────────────────────────────────────────────────────

// View-only annotations a consumer registers through `editor.getDecorations()`.
export type {
	Decoration,
	MarkDecoration,
	WidgetDecoration,
	ReplaceDecoration,
	BlockDecoration,
	DecorationWidgetSpec,
	ProvideContext,
	DecorationSource,
	DecorationSourceHandle,
	DecorationRegistry
} from './decorations/types';

// ── Rects ──────────────────────────────────────────────────────────────────────

// Viewport-space geometry over the rendered document, via `editor.getRects()`.
// SELECTION_END is the importable "through the block's last measurable position"
// sentinel `rangeRects` accepts as `end`.
export type { EditorRects } from './editor-rects';
export { SELECTION_END } from './block-component';
export type { SelectionEnd } from './block-component';
