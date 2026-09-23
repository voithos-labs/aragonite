// The plugin-authoring API, published at the `@voithos-labs/aragonite/plugin` subpath. Only the
// authoring API belongs here: not the `<Editor>` embedding barrel (index.ts), no test
// helpers, no internal dispatch. Sections tagged (pre-freeze) may change until the 1.0
// freeze.

import TextEditableBlock from './components/blocks/text/TextEditableBlock.svelte';
import { registerChromeLeaf as bindChromeLeaf } from './editor-actions/plugin/chrome-leaf';
import { computeInlineContent as parseLeafInline } from './core/inline';
import type { AnyBlockKind, InlineNode } from './core/nodes';
import type { NodeView } from './core/node-views';
import type { ChromeLeafOptions } from './editor-actions/plugin/chrome-leaf';

// ── Plugin unit (pre-freeze) ─────────────────────────────────────────────────
// Installation happens once per process; the editor's `plugins` prop does it, so a
// consumer rarely calls `installPlugins` directly.
export { definePlugin, isPluginInstalled } from './schema/plugin-install';
export type { EditorPlugin, EditorPluginEntry } from './schema/plugin-install';
// `setup(ctx)` registers `onEditor` callbacks that receive a per-instance `EditorContext`.
export type { PluginSetupContext, OnEditorCallback, EditorContext } from './schema/plugin-install';
// `EditorContext.insertMarkdown`'s options: at the caret, or in a new paragraph below its block.
export type { InsertMarkdownOptions } from './editor-props';
// The names every presentation-mode read reports, the `data-presentation` attribute included.
export type { PresentationMode } from './presentation-mode';
// The single-block shortcut: one kind, one component, one register step.
export { definePluginBlock } from './schema/define-plugin-block';

// ── Kind declaration ─────────────────────────────────────────────────────────
export { declarePluginKind, declaredPluginKind } from './schema/plugin-kind';
export type { PluginBlockKind, AnyBlockKind } from './core/nodes';

// ── Inline authoring API (pre-freeze) ────────────────────────────────────────
// Declare an inline kind, hook the scanner on a trigger character, register a live widget.
export {
	declarePluginInlineKind,
	declaredPluginInlineKind,
	isInlineKindDeclared
} from './schema/plugin-kind';
export type { PluginInlineKind, InlineNode, ImageFields, ImageSyntaxRewriter } from './core/nodes';
export { registerInlineSyntax, INLINE_PRIORITIES } from './core/inline/scan/plugin-syntax';
export type { InlineSyntaxRecognizer, InlineSyntaxOptions } from './core/inline/scan/plugin-syntax';
export {
	registerInlineWidgetKind,
	mintWidgetShell,
	isWidgetActivationClick
} from './core/inline/inline-widgets';
export type {
	InlineWidgetDescriptor,
	InlineWidgetComponentProps,
	InlineWidgetEditingPolicy,
	InlineWidgetEditingContext
} from './core/inline/inline-widgets';

// ── Block-kind descriptor registry ───────────────────────────────────────────
// `BlockKindRegistration` is the shape you register; `BlockKindDescriptor` is the flat shape
// the editor reads back, exported because `ContainerDescriptorGroup`'s fields refer to it.
export { registerBlockKind, augmentBlockKind } from './schema/block-kind-descriptor';
export type {
	BlockKindDescriptor,
	BlockKindRegistration,
	BlockKindAugmentation,
	ContainerDescriptorGroup,
	MergeRole,
	UnwrapRole
} from './schema/block-kind-descriptor';
// `rebuildRaw`'s optional second argument: the one child whose raw moved, for a rebuilder that
// re-emits that child's region alone. Ignoring it re-derives the whole raw, which is correct.
export type { ChildRawChange } from './schema/child-spans';
// The closure block every registration must answer the cross-cutting systems with.
// `simpleLeafClosure` and `containerClosure` fill in the fixed columns for a leaf and a container.
export type {
	ClosureBlock,
	ClosureColumn,
	ClosureCell,
	SimpleLeafClosureCells,
	ContainerClosureCells
} from './schema/closure';
export { simpleLeafClosure, containerClosure } from './schema/closure';

// ── Component registry ───────────────────────────────────────────────────────
export { registerBlockComponent, defineBlockComponent } from './schema/block-component-registry';
export type { BlockComponentEntry } from './schema/block-component-registry';
export type { BlockComponent, BlockComponentExports, BlockComponentProps } from './block-component';

// ── Parser-opener registry ───────────────────────────────────────────────────
export { registerBlockOpener } from './schema/block-openers';
export type { BlockOpener, BlockOpenerResult, OpenContext } from './schema/block-openers';
// The shared "does this line start a block at the outer level" gate, so a container opener
// scanning its own extent ends it where cmark-gfm does instead of forking the rule.
export { lineStartsOuterBlock } from './schema/block-openers';
export type { OuterBlockScan } from './schema/block-openers';
// The built-in priority order a plugin opener places itself in (pre-freeze); see the
// plugin guide's opener-priority section for the two placement rules.
export { OPENER_PRIORITIES } from './schema/opener-priorities';

// ── Enter-completion registry (pre-freeze) ───────────────────────────────────
// The opener's counterpart for a grammar whose lines must be adjacent, which Enter alone can
// never type into existence: a completer reads one typed line and answers the lines that
// complete it, plus where the caret goes in the new block.
export { registerBlockCompleter } from './schema/block-completions';
export type { BlockCompleter, CompletionResult } from './schema/block-completions';

// ── Code-block languages (pre-freeze) ────────────────────────────────────────
// The registry behind fenced-code highlighting. The editor loads a curated set (every grammar
// is bundle weight for every consumer), so a host that needs more registers them itself, before
// mounting an editor: a block already on screen re-tokenizes only when its bytes next change.
// An unregistered language is not an error; the fence still round-trips, just untokenized.
// `listLanguages` lists each language once; `getLanguageAliases` holds the other spellings.
export {
	registerLanguage,
	listLanguages,
	getLanguageAliases
} from './components/blocks/code/code-languages';
export type { LanguageGrammar } from './components/blocks/code/code-languages';
// The code block's own tokenizer, for a plugin whose own source view wants the same highlighting
// (block math paints its LaTeX with it). Text-preserving: the fragment's `textContent` is `body`.
export { tokenizeBody as highlightCode } from './components/blocks/code/code-renderer';
// Re-exported so a host names the grammar type without importing highlight.js itself, which
// it holds only transitively.
export type { LanguageFn } from 'highlight.js';

// ── Command vocabulary + keybindings (pre-freeze) ────────────────────────────
// The built-in half; a plugin's own commands are created in the section below.
export type { CommandId } from './schema/commands';
export type { KeyBinding } from './schema/keybindings';

// ── Registering commands (pre-freeze) ────────────────────────────────────────
// A (kind, name) block command creates a `PluginCommandId`; `AnyCommandId` covers both.
export { registerBlockCommand } from './schema/block-commands';
// The block context menu: a kind's right-click actions, empty unless something registers them.
export { registerBlockContextActions } from './schema/context-actions';
export type {
	BlockContextAction,
	BlockActionContext,
	BlockContextActionProvider
} from './schema/context-actions';
export type { BlockCommandContext, BlockCommandHandler } from './schema/block-commands';
export type { PluginCommandId, AnyCommandId } from './schema/command-id';
// A global command is process-wide but runs against the dispatching instance's `EditorContext`,
// with the argument `runCommand(id, arg)` or the chord's binding carried.
export { registerGlobalCommand } from './schema/global-commands';

// ── Parse / serialize helpers (pre-freeze) ───────────────────────────────────
// Re-exported so an opener needn't reach into core/ deep paths the packaged artifact
// doesn't expose.
export { parse, type ParseScope } from './core/parser';
export type { Document } from './core/nodes';
export { serialize, concatChildren as serializeChildren } from './core/serializer';
export { trimTrailingLineEnding, normalizeLineEndings } from './core/lines';
// The `ParsedLine[]` every line-based helper here takes; without it a `source →
// source` transform holding nothing but a string could not reach `blockquoteExtent`.
export { splitLines } from './core/lines';
export type { ParsedLine } from './core/lines';
// GFM §2.1's blank line (spaces and tabs only). `String.trim()` would admit the whole
// Unicode whitespace set and split a block on a pasted non-breaking space.
export { isBlankLine } from './core/parser';
// A container whose body sits between marker lines of its own (`:::note` … `:::`,
// `<summary>` … `</details>`) parses that body here, not with `parse`: the blank line
// against a marker line is a separator, and only this function knows to keep it out of
// the children. See `design/syntax-tree.md` § blank lines.
export { parseContainerBody } from './core/parser';
export type { ContainerBodyWrap } from './core/parser';

// ── Fence grammar (pre-freeze) ───────────────────────────────────────────────
// The built-in CommonMark fence recognizers, so a plugin that takes over a fence (```mermaid)
// never reimplements the rules. The opener match keeps the indent and info bytes verbatim, for
// byte-exact rebuilds; `escalatedFenceLength` is the fence counterpart of `escalatedColonCount`,
// which any kind that rebuilds its own raw around a body it did not parse needs.
export { matchFenceOpen, matchFenceClose, escalatedFenceLength } from './core/parsers/fence-syntax';
export type { FenceOpen } from './core/parsers/fence-syntax';

// ── HTML tag-line grammar (pre-freeze) ───────────────────────────────────────
// CommonMark's type-6 tag-line shape for one tag name. What actually closes such a
// container is everything the spec passes through raw (indented, upper-cased, trailing
// space), which is looser than any canonical form a rebuild emits.
export { htmlBlockTagLineMatcher } from './core/parsers/html-block';

// ── Blockquote grammar (pre-freeze) ──────────────────────────────────────────
// The built-in blockquote extent scanner, so a plugin that takes over a blockquote-shaped
// construct (`> [!NOTE]`) reuses CommonMark §5.1 lazy continuation instead of writing its own.
export { blockquoteExtent } from './core/parsers/blockquote';

// ── CST node access (pre-freeze; the metadata pair below is stable) ──────────
export type { CstNode } from './core/nodes';
// Reads get views whose bytes are readonly; `CstNode` and `Document` stay the types a plugin
// builds (openers, factories, `rebuildRaw`), and those stay mutable.
export type { NodeView, DocumentView } from './core/node-views';
// Store/read a plugin kind's own metadata shape without casting through `BlockMetadata`.
export { setPluginMetadata, getPluginMetadata } from './core/nodes';
// The content span within a block's raw, syntax markers excluded (a heading's `#` prefix).
export { getContentRange } from './core/inline';
export type { ContentRange } from './core/inline';
// A heading's level (ATX or setext), null otherwise: the typed way to ask, since the
// built-in node narrowing stays internal to this barrel.
export { headingLevel } from './core/nodes';
// Pure and uncached, so a widget's `$derived` can read it safely. `isProseKind` guards the
// traversal so a code block's bytes are never inline-scanned.
export { isProseKind } from './core/inline';

/**
 * Inline-parse a prose leaf. No link-reference resolver is available to a plugin, so
 * reference links parse as `unresolvedReference`; every other construct fully resolves.
 */
export function computeInlineContent(node: NodeView): InlineNode[] {
	return parseLeafInline(node);
}

// ── Re-registration checks ─────────────────────────────────────────────────────
// The register-once registries throw on duplicate; a plugin re-registers safely
// (HMR / re-import) by guarding on these.
export { isBlockKindDeclared } from './schema/plugin-kind';
export { isBlockKindRegistered } from './schema/block-kind-descriptor';
export { isBlockComponentRegistered } from './schema/block-component-registry';
export { isBlockOpenerRegistered } from './schema/block-openers';
export { isBlockCompleterRegistered } from './schema/block-completions';
export { isPasteTransformRegistered } from './tree-operations/paste/paste-transforms';

// ── Container-authoring API (pre-freeze) ─────────────────────────────────────
// Lets a plugin build an editable nested container as thinly as the built-in
// blockquote, without touching any editor context key.
export { default as BlockList } from './components/BlockList.svelte';
export { createContainerBlock } from './editor-actions/plugin/container';
export type {
	ContainerBlock,
	ContainerBlockComponent,
	ContainerBlockDeps,
	ContainerBlockListProps
} from './editor-actions/plugin/container';
export type { RefSlots } from './reactivity/publish-ref.svelte';
// The one place allowed to import from `components/`, so `editor-actions` keeps no upward
// value dependency on the component tree.
export function registerChromeLeaf(kind: AnyBlockKind, opts?: ChromeLeafOptions): void {
	bindChromeLeaf(kind, TextEditableBlock, opts);
}
export type { ChromeLeafOptions };
// Create the reserved child-0 node for a container's title leaf: the text plus its newline.
export { chromeChild } from './editor-actions/plugin/chrome-leaf';
// One definition of collapsed, shared by a component's getter and the traversals over the CST.
export { isCollapsedContainer } from './schema/reserved-chrome';

// ── Editable-leaf authoring API (pre-freeze) ─────────────────────────────────
// A text-editing leaf with the browser's own caret, IME, undo and selection behaviour, either
// plain (one commit per keystroke) or render-first (the source shows while the caret is inside,
// one commit on blur). The `createContainerBlock` counterpart for leaves.
export { createEditableLeaf } from './components/blocks/editable-leaf';
export type {
	EditableLeaf,
	EditableLeafDeps,
	EditableLeafMode,
	EditableLeafSurfaceProps,
	EditableLeafRenderProps
} from './components/blocks/editable-leaf';
export type { StickyColumnDirection } from './block-component';

// ── Directive authoring (pre-freeze) ─────────────────────────────────────────
// `activateDirectives()` takes over `:::`; call it once at startup, before the editor
// parses. The other symbols do nothing on their own: importing them takes over no grammar.
export { activateDirectives } from './components/blocks/directive/activate-directives';
export { registerDirective, isDirectiveRegistered } from './core/directive/registry';
export type { DirectiveDefinition, ParsedDirective } from './core/directive/registry';
// `escalatedColonCount` is the rule `serializeDirective` already applies; exported for
// emitters that build `:::name` text by concatenation instead of through the CST, where
// a body line reproducing the fence would otherwise close the container early.
export {
	escalatedColonCount,
	parseDirectiveAttributes,
	serializeDirective
} from './core/directive/grammar';
export type { DirectiveTier, DirectiveFence, DirectiveAttributes } from './core/directive/grammar';
// The `rebuildRaw` for a directive container whose child 0 is an editable title.
export { createDirectiveRebuild } from './editor-actions/plugin/directive-container';
// The wrap every `:::` body parses with; a directive kind declares it as its `container.bodyWrap`
// so the editor's blank-line fix-up knows the blank line against the fence belongs to the fence.
export { DIRECTIVE_BODY_WRAP } from './core/directive/kinds';

// ── Renderer utilities (pre-freeze) ──────────────────────────────────────────
// A bounded LRU memo for a renderer's per-source work, sync or async (store the
// promise). See the plugin guide's renderer recipe.
export { createBoundedMemo } from './bounded-memo';
export type { BoundedMemoOptions } from './bounded-memo';

// ── Recognizer scan index (pre-freeze) ───────────────────────────────────────
// How to decline cheaply when a grammar has no early-stop byte (the guide's inline-kinds
// section): a per-block position collector becomes a memoized lookup answering the first
// candidate at or after `from` (-1 when none), one scan per block behind a two-entry memo.
export { createScanIndex } from './scan-index';

// ── Paste transforms (pre-freeze) ────────────────────────────────────────────
// A pre-parse clipboard rewrite: inspect the raw pasted text, replace it or decline
// (null). Transforms run in install order at every paste, never on load or while typing.
export { registerPasteTransform } from './tree-operations/paste/paste-transforms';
export type { PasteTransform } from './tree-operations/paste/paste-transforms';

// ── Decorations (pre-freeze) ─────────────────────────────────────────────────
// View-only annotations layered over the rendered document, never part of the CST.
// Sources register per-instance through `editor.decorations` (the onEditor context).
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

// ── Events (pre-freeze) ──────────────────────────────────────────────────────
// The payloads `EditorContext.events` delivers. `EditEvent` is the matched pair a structural
// change reports, so an `edit` handler narrows `op` against the real set of operation names
// instead of a bare string.
export type {
	EditEvent,
	EditorEventMap,
	SelectionChangeEvent,
	EditorError,
	SourceSwapEvent
} from './editor-events';
export type { OperationKind } from './schema/operations';

// ── Inline menus (pre-freeze) ────────────────────────────────────────────────
// Lists opened under the caret by a typed trigger, reached through `editor.inlineMenus`.
export type {
	InlineMenuRegistry,
	InlineMenuOpenOptions,
	InlineMenuSource,
	InlineMenuSourceHandle,
	InlineMenuItem,
	InlineMenuQuery,
	InlineMenuRowProps
} from './inline-menu/types';

// ── Insert catalogue (pre-freeze) ────────────────────────────────────────────
// The blocks the insert menus offer, read through `editor.insertCatalogue`. A plugin adds its own
// block from `setup`, listed only in the editors that activate it; the icon is a menu glyph name.
export { registerInsertEntry } from './schema/insert-catalogue';
export type { InsertEntry } from './schema/insert-catalogue';
export type { MenuIconName } from './menu-icons';

// ── Rects (pre-freeze) ───────────────────────────────────────────────────────
// Viewport-space geometry over the rendered document, reached through `editor.rects`.
export type { EditorRects } from './editor-rects';

// ── Caret geometry (pre-freeze) ──────────────────────────────────────────────
// What a kind answers `caretTargetAtPoint` with: the shape saying where the caret goes, the
// helper that turns a point inside one of your elements into an offset (it picks the nearest,
// so a click on your own markers still names one), and the value for "wherever this leaf ends".
export { caretOffsetAtPoint } from './cursor/point-offset';
export type { CaretTarget } from './schema/block-kind-descriptor';
export { CURSOR_END } from './block-component';
export type { CursorEnd } from './block-component';

// ── Pointer gestures (pre-freeze) ────────────────────────────────────────────
// Put this attribute on an element whose drags belong to your widget (a pan, a brush) and the
// editor's pointer handlers leave a click inside it alone: no block range, no click handling.
export { POINTER_GESTURE_ATTR } from './selection/pointer-gesture';

// ── Selection geometry (pre-freeze) ──────────────────────────────────────────
// The selection shapes a decoration source or a rect caller reads. `SELECTION_END` is
// the special value `rangeRects` accepts as `end`.
export type { EditorSelection, SelectionPoint } from './selection/primitives';
export { SELECTION_END } from './block-component';
export type { SelectionEnd } from './block-component';
