// The editor module's public, supported API: adding an export is non-breaking,
// removing one is breaking. Anything not re-exported here is internal. Its types name no Svelte
// type; the `<Editor>` component and the Svelte helpers are on `@voithos-labs/aragonite/svelte`.

// ── Mounting ─────────────────────────────────────────────────────────────────

export { createEditor, type CreateEditorOptions, type EditorHandle } from './create-editor';

export { EDITOR_OPTION_SPECS } from './editor-props';
export type {
	EditorOptions,
	EditorInstance,
	InsertMarkdownOptions,
	PlaceholderBlock,
	SyntaxOptions
} from './editor-props';

export type {
	EditorDiagnostics,
	InteractionTraceEntry,
	InputRecording,
	InputRecordingHandle,
	InputRecordingOptions
} from './editor-props';

export type { BlockComponent } from './block-component';
export type {
	ResolveImageUrl,
	ResolveLinkUrl,
	PastedImage,
	PasteImageHook,
	CodeRunRequest,
	RunCodeHook,
	CodeMenuItem,
	CodeMenuItemsHook
} from './host-hooks';
export type { ImageLoadPolicy } from './core/inline-render';
export type { PresentationMode } from './presentation-mode';
export type { LinkClick } from './activation-click';
export type { SearchState, SearchOptions } from './search/search-state.svelte';
export type { Match } from './search/document-scan';

// ── Plugins ────────────────────────────────────────────────────────────────────

// installPlugins is for editor-less `parse()` pipelines that need the grammar live
// without mounting <Editor>.
export { installPlugins } from './schema/plugin-install';
export type { EditorPlugin, EditorPluginEntry } from './schema/plugin-install';

// ── Selection + keybindings ────────────────────────────────────────────────────

export type { EditorSelection, SelectionPoint } from './selection/primitives';
// Document order over a selection's endpoints, so a host anchoring UI to a range needn't
// re-derive path-lexicographic comparison.
export { normalize as normalizeSelection } from './selection/primitives';
export type { KeybindingOverride } from './schema/keybinding-overrides';
export type { CommandId } from './schema/commands';

// ── Commands (pre-freeze: the id space opens up when the command registry unifies) ──

// The ids `editor.runCommand()` supports: what a selection toolbar needs.
export { TOOLBAR_COMMANDS } from './schema/commands';

// ── CST utilities ────────────────────────────────────────────────────────────

export { parse, type ParseScope } from './core/parser';
export { serialize } from './core/serializer';
export { parseInline, getContentRange, isProseKind } from './core/inline';
export type { ContentRange } from './core/inline';

// ── Node & inline types ──────────────────────────────────────────────────────

export type {
	BlockKind,
	LeafBlockKind,
	ContainerBlockKind,
	// What a node's `kind` actually is: a built-in kind or a plugin's own declared name.
	AnyBlockKind,
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
	SelectionChangeEvent,
	SourceSwapEvent
} from './editor-events';

// ── Decorations ──────────────────────────────────────────────────────────────

// View-only annotations a consumer registers through `editor.getDecorations()`.
export type {
	Decoration,
	MarkDecoration,
	MarkInteractions,
	MarkHover,
	WidgetDecoration,
	ReplaceDecoration,
	BlockDecoration,
	DecorationWidgetSpec,
	ProvideContext,
	DecorationSource,
	DecorationSourceHandle,
	DecorationRegistry
} from './decorations/types';

// ── Plugin views ─────────────────────────────────────────────────────────────

// What a decoration widget or a menu row draws with: a function that fills the element the editor
// hands it. `@voithos-labs/aragonite/svelte` makes one from a Svelte component.
export type { PluginView, PluginViewHandle } from './plugin-view';

// ── Rects ──────────────────────────────────────────────────────────────────────

// Viewport-space geometry over the rendered document, via `editor.getRects()`.
// `SELECTION_END` is the special value `rangeRects` accepts as `end`.
export type { EditorRects } from './editor-rects';
export { SELECTION_END } from './block-component';
export type { SelectionEnd } from './block-component';

// ── Inline menus ───────────────────────────────────────────────────────────────

// Lists opened under the caret by a typed trigger (`#`, `[[`), via `editor.getInlineMenus()`.
export type {
	InlineMenuRegistry,
	InlineMenuOpenOptions,
	InlineMenuSource,
	InlineMenuSourceHandle,
	InlineMenuItem,
	InlineMenuQuery,
	InlineMenuRowProps
} from './inline-menu/types';

// ── Insert catalogue ───────────────────────────────────────────────────────────

// The blocks the insert menus offer, plugin blocks included, via `editor.getInsertCatalogue()`.
export { registerInsertEntry } from './schema/insert-catalogue';
export type { InsertEntry } from './schema/insert-catalogue';
export type { MenuIconName } from './menu-icons';
