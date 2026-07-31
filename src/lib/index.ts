// Public, supported surface of the editor module: adding an export is non-breaking,
// removing one is breaking. Anything not re-exported here is internal.

// ── Component ────────────────────────────────────────────────────────────────

export { default as Editor } from './components/Editor.svelte';

export type { EditorProps, EditorInstance } from './editor-props';

export type { EditorDiagnostics, InteractionTraceEntry } from './editor-props';

export type { BlockComponent } from './block-component';
export type { ResolveImageUrl, ResolveLinkUrl, PastedImage, PasteImageHook } from './editor-keys';
export type { ImageLoadPolicy } from './core/inline-render';
export type { PresentationMode } from './presentation-mode';
export type { SearchState, SearchOptions } from './search/search-state.svelte';
export type { Match } from './search/document-scan';

// ── Plugins ────────────────────────────────────────────────────────────────────

// installPlugins is for editor-less `parse()` pipelines that need the grammar live
// without mounting <Editor>.
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

// The bytes-readonly views a consumer reads the CST through; mutation goes through commits.
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
// SELECTION_END is the sentinel `rangeRects` accepts as `end`.
export type { EditorRects } from './editor-rects';
export { SELECTION_END } from './block-component';
export type { SelectionEnd } from './block-component';
