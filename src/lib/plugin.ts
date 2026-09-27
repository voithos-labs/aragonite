// The plugin-authoring API, published at the `@voithos-labs/aragonite/plugin` subpath. Only the
// authoring API belongs here: not the `<Editor>` embedding barrel (index.ts), no test
// helpers, no internal dispatch. Sections tagged (pre-freeze) may change until the 1.0
// freeze.

import TextEditableBlock from './components/blocks/text/TextEditableBlock.svelte';
import { registerChromeLeaf as bindChromeLeaf } from './editor-actions/plugin/chrome-leaf';
import { computeInlineContent as parseLeafInline } from './core/inline';
import { defaultGrammarView } from './schema/block-openers';
import { everyInstalledPlugin } from './schema/plugin-activation';
import {
	getLanguageAliases as aliasesIn,
	listLanguages as languagesIn
} from './components/blocks/code/code-languages';
import { tokenizeBody } from './components/blocks/code/code-renderer';
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
	UnwrapRole,
	WriteContext,
	WriteRule
} from './schema/block-kind-descriptor';
// What `estimateHeight` reads besides the block: the width and the editor's type metrics.
export type { HeightEstimateEnv } from './schema/height-estimates';
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
// A completer reads one typed line and answers the lines that complete it, plus the caret: for a
// grammar whose lines must be adjacent, which Enter alone never types.
export { registerBlockCompleter } from './schema/block-completions';
export type { BlockCompleter, CompletionResult } from './schema/block-completions';

// ── Code-block languages (pre-freeze) ────────────────────────────────────────
// The registry behind fenced-code highlighting: register extra languages before mounting (an
// unregistered one round-trips untokenized). The reads below see every installed plugin's.
export { registerLanguage } from './components/blocks/code/code-languages';
export type { LanguageGrammar } from './components/blocks/code/code-languages';
/** Every language once, under its canonical name, sorted. */
export function listLanguages(): string[] {
	return languagesIn(everyInstalledPlugin);
}
/** The other spellings a language answers to, asked by any of them. */
export function getLanguageAliases(name: string): readonly string[] {
	return aliasesIn(name, everyInstalledPlugin);
}
/** The code block's own tokenizer, for a plugin's own source view (block math paints its LaTeX
 *  with it). Text-preserving: the fragment's `textContent` is `body`. */
export function highlightCode(body: string, language: string): DocumentFragment {
	return tokenizeBody(body, language, everyInstalledPlugin);
}
// Re-exported so a host names the grammar type without importing highlight.js itself, which
// it holds only transitively.
export type { LanguageFn } from 'highlight.js';
// The code block's own drawing of a fenced source, for a kind that holds its own fence: split
// with `sliceFencedSource`, draw with `renderFencedSource` and your body painter.
export {
	sliceFencedSource,
	renderFencedSource,
	fenceBodyAsDrawn
} from './components/blocks/code/code-renderer';
export type { FencedSource } from './components/blocks/code/code-renderer';

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
// A line a plugin writes takes the document's ending, and per-line work reads a line's text
// without its ending, so a CRLF document stays CRLF through a plugin's write rule.
export {
	documentLineEnding,
	firstLineEnding,
	ownTrailingLineEnding,
	trailingLineEnding,
	displayLines,
	joinDisplayLines
} from './core/lines';
export type { LineEnding } from './core/lines';
// GFM §2.1's blank line (spaces and tabs only) and its whitespace, for a plugin's grammar.
// `String.trim()` and JS `\s` would also take a non-breaking space, which is content.
export { isBlankLine } from './core/parser';
export { isBlankText, isWhitespaceChar, trimWhitespace } from './core/lines';
// A body between marker lines of its own (`:::note` … `:::`) parses here, not with `parse`: the
// blank line against a marker line is a separator (`docs/design/syntax-tree.md` § Blank lines).
export { parseContainerBody } from './core/parser';
export type { ContainerBodyWrap } from './core/parser';

// ── Fence grammar (pre-freeze) ───────────────────────────────────────────────
// The CommonMark fence grammar, so a plugin taking over a fence (```mermaid) never reimplements
// it: `fenceRawWrite` serves as its `rawWrite`, and `escalatedFenceLength` sizes a rebuilt fence.
export {
	matchFenceOpen,
	matchFenceClose,
	escalatedFenceLength,
	findFenceCloser,
	fenceAnatomy,
	matchFenceInfo
} from './core/parsers/fence-syntax';
export type { FenceOpen, FenceRun, FenceAnatomy } from './core/parsers/fence-syntax';
export { scanFence } from './core/parsers/fenced-code';
export type { FenceScan } from './core/parsers/fenced-code';
export { fenceRawWrite, fenceShapeOfRaw } from './schema/fenced-code-raw';
export type { FenceShape } from './schema/fenced-code-raw';

// ── HTML tag-line grammar (pre-freeze) ───────────────────────────────────────
// CommonMark's type-6 tag-line shape for one tag name. What closes such a container is anything
// the spec passes through raw, looser than the canonical form a rebuild emits.
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
// Pre-order over a document or subtree, with 'skip' and 'stop', so a plugin writes no recursion.
export { walkBlocks } from './core/paths';
// The block at a path, or null for the root or a path that leads nowhere.
export { blockNodeAt } from './tree-operations/node-primitives';

/**
 * Inline-parse a prose leaf with every installed plugin's syntax, for a pipeline with no editor
 * mounted. Inside an editor use `EditorContext.computeInlineContent`, which reads only the plugins
 * that editor lists. Reference links parse as `unresolvedReference`: no resolver reaches a plugin.
 */
export function computeInlineContent(node: NodeView): InlineNode[] {
	return parseLeafInline(node, undefined, defaultGrammarView);
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
export { isLanguageRegistered } from './components/blocks/code/code-languages';

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
// A text-editing leaf with the browser's own caret, IME, undo and selection: plain (a commit per
// keystroke) or render-first (source while the caret is inside, one commit on blur).
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
// `escalatedColonCount` is the rule `serializeDirective` applies, for emitters building `:::name`
// text by concatenation, where a body line reproducing the fence would close it early.
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
// For a grammar with no early-stop byte: collect candidate positions once per block, then answer
// the first at or after `from` (-1 when none) behind a two-entry memo.
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
// The payloads `EditorContext.events` delivers. `EditEvent` pairs each operation name with its
// detail, so an `edit` handler narrows `op` against the real set of names.
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
// What a kind answers `caretTargetAtPoint` with, the helper that turns a point in your element
// into the nearest offset, and the value for wherever the leaf ends.
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
