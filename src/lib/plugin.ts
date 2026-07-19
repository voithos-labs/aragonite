// The plugin-authoring surface, published at the `aragonite/plugin` subpath.
// Separate from the `<Editor>` consumer barrel (index.ts) on purpose: this is the
// authoring API, not the embedding API. Only the authoring surface belongs here —
// no test helpers, no internal getters or dispatch.

import TextEditableBlock from './components/blocks/text/TextEditableBlock.svelte';
import { registerChromeLeaf as bindChromeLeaf } from './editor-actions/plugin/chrome-leaf';
import type { AnyBlockKind } from './core/nodes';
import type { ChromeLeafOptions } from './editor-actions/plugin/chrome-leaf';

// ── Plugin unit (pre-freeze / unstable) ──────────────────────────────────────
// Being refined until the open-source release — NOT yet frozen; shape may change.
// definePlugin validates a { name, setup } unit at definition time; the editor's
// `plugins` prop installs each once per process, so a consumer rarely calls
// installPlugins directly. isPluginInstalled is the idempotence probe.
export { definePlugin, isPluginInstalled } from './schema/plugin-install';
export type { EditorPlugin, EditorPluginEntry } from './schema/plugin-install';
// The setup-context spine: `setup(ctx)` registers `onEditor` callbacks that
// receive a per-instance EditorContext (editorId, live document, subscribe-only
// events, typed options, live presentationMode).
export type { PluginSetupContext, OnEditorCallback, EditorContext } from './schema/plugin-install';
// The presentation-mode vocabulary every mode read reports (EditorContext,
// the editable-leaf getter, InlineWidgetComponentProps.getPresentationMode,
// InlineWidgetEditingContext.presentationMode, the `data-presentation` root attr).
export type { PresentationMode } from './presentation-mode';
// The single-block plugin unit: one kind, one component, one register step. The
// common case that needn't touch definePlugin + registerBlockComponent directly.
export { definePluginBlock } from './schema/define-plugin-block';

// ── Kind declaration ─────────────────────────────────────────────────────────
export { declarePluginKind, declaredPluginKind } from './schema/plugin-kind';
export type { PluginBlockKind, AnyBlockKind } from './core/nodes';

// ── Inline authoring surface (pre-freeze / unstable) ─────────────────────────
// Being refined against the KaTeX/inline-widget work until the open-source
// release — NOT yet frozen; shape may change. Mint an inline kind, hook the
// scanner on a trigger character, and register a kind as a live atomic widget
// with its editing policy. The internal seams (first-party widget augmentation,
// the recognizer/editing accessors, test resets) stay off this barrel.
export {
	declarePluginInlineKind,
	declaredPluginInlineKind,
	isInlineKindDeclared
} from './schema/plugin-kind';
export type { PluginInlineKind, InlineNode } from './core/nodes';
export { registerInlineSyntax } from './core/inline/scan/plugin-syntax';
export type { InlineSyntaxRecognizer } from './core/inline/scan/plugin-syntax';
export { registerInlineWidgetKind } from './core/inline/inline-widgets';
export type {
	InlineWidgetDescriptor,
	InlineWidgetComponentProps,
	InlineWidgetEditingPolicy,
	InlineWidgetEditingContext
} from './core/inline/inline-widgets';

// ── Block-kind descriptor registry ───────────────────────────────────────────
// BlockKindRegistration is the write-side shape (container-only fields grouped
// under `container`, isContainer derived); BlockKindDescriptor stays exported as
// the flat read-side shape — the referent of ContainerDescriptorGroup's field types.
export { registerBlockKind, augmentBlockKind } from './schema/block-kind-descriptor';
export type {
	BlockKindDescriptor,
	BlockKindRegistration,
	BlockKindAugmentation,
	ContainerDescriptorGroup,
	MergeRole,
	UnwrapRole
} from './schema/block-kind-descriptor';
// The required closure block a registration answers every cross-cutting system
// with. `simpleLeafClosure` is sugar over the same field for a not-mergeable,
// source-editable leaf: it bakes the structurally-fixed columns and demands the
// four the leaf's own component determines. Containers hand-write the full nine.
export type {
	ClosureBlock,
	ClosureColumn,
	ClosureCell,
	SimpleLeafClosureCells
} from './schema/closure';
export { simpleLeafClosure } from './schema/closure';

// ── Component registry ───────────────────────────────────────────────────────
export { registerBlockComponent, defineBlockComponent } from './schema/block-component-registry';
export type { BlockComponentEntry } from './schema/block-component-registry';
export type { BlockComponent, BlockComponentProps } from './block-component';

// ── Parser-opener registry ───────────────────────────────────────────────────
export { registerBlockOpener } from './schema/block-openers';
export type { BlockOpener, OpenContext } from './schema/block-openers';
// The built-in priority ladder a plugin opener prices against — see the plugin
// guide's opener-priority section for the two placement rules.
export { OPENER_PRIORITIES } from './schema/opener-priorities';

// ── Command vocabulary + keybindings ─────────────────────────────────────────
// CommandId names the built-in command a keymap binding targets; KeyBinding is
// the per-kind chord→command shape. The command-mint section below adds the
// authoring surface for a plugin's own block-commands.
export type { CommandId } from './schema/commands';
export type { KeyBinding } from './schema/keybindings';

// ── Command mint ─────────────────────────────────────────────────────────────
// registerBlockCommand binds a (kind, name) block-command and returns its minted
// PluginCommandId; the handler runs against a BlockCommandContext (focused node +
// metadata writer). AnyCommandId spans built-in and minted ids for keymap typing.
export { registerBlockCommand } from './schema/block-commands';
export type { BlockCommandContext, BlockCommandHandler } from './schema/block-commands';
export type { PluginCommandId, AnyCommandId } from './schema/command-id';
// registerGlobalCommand mints a process-wide command run against the dispatching
// instance's EditorContext, optionally bound to a chord in the plugin-global tier.
export { registerGlobalCommand } from './schema/global-commands';

// ── Parse / serialize helpers ────────────────────────────────────────────────
// The recognizer/serializer halves of an opener: parse a body to a Document,
// join child bytes back, read a child's display text without dropping a CRLF,
// and normalize external text to LF before it enters the tree. Re-exported here
// so an opener needn't reach into core/ deep paths that the packaged artifact
// doesn't expose.
export { parse } from './core/parser';
export type { Document } from './core/nodes';
export { concatChildren as serializeChildren } from './core/serializer';
export { trimTrailingLineEnding, normalizeLineEndings } from './core/lines';
export type { ParsedLine } from './core/lines';

// ── Fence grammar (pre-freeze / unstable) ────────────────────────────────────
// Being refined against the fence-claiming reference plugins until the
// open-source release — NOT yet frozen; shape may change. The built-in
// CommonMark fence recognizers, so a plugin claiming a fence (```mermaid) never
// reimplements the fence rules: match an opener line (verbatim indent/info
// bytes included, for byte-exact rebuilds) and test a closer line against it.
export { matchFenceOpen, matchFenceClose } from './core/parsers/fenced-code';
export type { FenceOpen } from './core/parsers/fenced-code';

// ── CST node access ────────────────────────────────────────────────────────────
export type { CstNode } from './core/nodes';
// The bytes-readonly views every read surface hands a plugin (component props,
// EditorContext.document, DecorationSource.provide, descriptor read hooks).
// CstNode/Document stay the types a plugin CONSTRUCTS (openers, factories,
// rebuildRaw) — reads get views, owned/built nodes stay mutable.
export type { NodeView, DocumentView } from './core/node-views';
// Typed plugin metadata: store/read a plugin kind's own shape without casting
// through the built-in `BlockMetadata` union at the call site.
export { setPluginMetadata, getPluginMetadata } from './core/nodes';
// The content span within a block's raw, syntax markers excluded (a heading's
// `#` prefix, a setext underline) — the offsets a marker-reading plugin slices.
export { getContentRange } from './core/inline';
export type { ContentRange } from './core/inline';

// ── Idempotent-registration probes ─────────────────────────────────────────────
// The register-once registries throw on duplicate; a plugin re-registers safely
// (HMR / re-import) by guarding on these.
export { isBlockKindRegistered } from './schema/block-kind-descriptor';
export { isBlockComponentRegistered } from './schema/block-component-registry';
export { isBlockOpenerRegistered } from './schema/block-openers';

// ── Container-authoring surface (pre-freeze / unstable) ─────────────────────────
// Being refined against real plugin blocks until the open-source release — NOT
// yet frozen; shape may change. Lets a plugin build an editable nested container
// as thinly as the built-in blockquote, without touching any editor context key.
export { default as BlockList } from './components/BlockList.svelte';
export { createContainerBlock } from './editor-actions/plugin/container';
export type {
	ContainerBlock,
	ContainerBlockComponent,
	ContainerBlockDeps,
	ContainerBlockListProps
} from './editor-actions/plugin/container';
// registerChromeLeaf binds the editor's built-in text surface as the leaf
// component here — the one seam allowed to import components/, so editor-actions
// keeps no upward value edge to the component tree.
export function registerChromeLeaf(kind: AnyBlockKind, opts?: ChromeLeafOptions): void {
	bindChromeLeaf(kind, TextEditableBlock, opts);
}
export type { ChromeLeafOptions };
// Mint the reserved child-0 node for the chrome leaf a container declares — the
// title/summary text plus its trailing newline.
export { chromeChild } from './editor-actions/plugin/chrome-leaf';
// Reads the descriptor's `reservedChrome.isCollapsed` probe, so a component's
// collapse getter and the model-layer walks share one definition.
export { isCollapsedContainer } from './schema/reserved-chrome';

// ── Editable-leaf authoring surface (pre-freeze / unstable) ──────────────────
// Being refined against the block-math work until the open-source release —
// NOT yet frozen; shape may change. Lets a plugin build a text-editing leaf
// block with native caret/IME/undo/cross-block-selection parity — plain
// (always-editable, per-keystroke commits) or render-primary (rendered view,
// reveal-to-edit, one commit on blur) — without touching any editor context
// key. The createContainerBlock sibling for leaves.
export { createEditableLeaf } from './components/blocks/editable-leaf';
export type {
	EditableLeaf,
	EditableLeafDeps,
	EditableLeafMode
} from './components/blocks/editable-leaf';
export type { StickyColumnDirection } from './block-component';

// ── Directive authoring (pre-freeze / unstable) ──────────────────────────────
// Being refined against the `:::name` directive work until the open-source
// release — NOT yet frozen; shape may change. `activateDirectives()` turns the
// grammar on (generic kinds + `:::`/`::` openers + inline `:` recognizer + generic
// render); call it once at startup, before the editor parses. The remaining
// symbols are inert — importing them does NOT claim `:::`, only the call does.
// Register a name→kind directive, read the opener info into structure, and
// serialize a fence losslessly.
export { activateDirectives } from './components/blocks/directive/activate-directives';
export { registerDirective, isDirectiveRegistered } from './core/directive/registry';
export type { DirectiveDefinition, ParsedDirective } from './core/directive/registry';
export { parseDirectiveAttributes, serializeDirective } from './core/directive/grammar';
export type { DirectiveTier, DirectiveFence, DirectiveAttributes } from './core/directive/grammar';
// Build the `rebuildRaw` for a directive container whose child 0 is an editable
// title — owns the title→opener, body serialization, and CRLF line-ending threading.
export { createDirectiveRebuild } from './editor-actions/plugin/directive-container';

// ── Renderer utilities ────────────────────────────────────────────────────────
// A bounded LRU memo for a plugin renderer's per-source work: sync (with an
// optional clone-on-read for live DOM nodes) or async (the value is the render
// promise, so in-flight work is shared and a rejection is cached). See the plugin
// guide's renderer recipe.
export { createBoundedMemo } from './bounded-memo';
export type { BoundedMemoOptions } from './bounded-memo';

// ── Paste transforms (pre-freeze / unstable) ──────────────────────────────────
// Being refined against the conversion-config direction until the open-source
// release — NOT yet frozen; shape may change. registerPasteTransform records a
// content-keyed, pre-parse clipboard rewrite: it inspects the raw pasted text and
// either replaces it or declines (null). Transforms run in install order at every
// paste site, before the text is parsed — paste-scoped only; loading and typing
// are untouched.
export { registerPasteTransform } from './tree-operations/paste/paste-transforms';
export type { PasteTransform } from './tree-operations/paste/paste-transforms';

// ── Decorations (pre-freeze / unstable) ──────────────────────────────────────
// View-only annotations layered over the rendered document — never part of the
// CST. A plugin registers a pure per-instance DecorationSource through
// `editor.decorations` (its onEditor context) and gets a handle back to
// invalidate or dispose it.
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

// ── Rects (pre-freeze / unstable) ────────────────────────────────────────────
// Viewport-space geometry over the rendered document, reached through
// `editor.rects` (its onEditor context): a block's box, an inline range's rects,
// the native caret, and a reveal that mounts a windowed-out block.
export type { EditorRects } from './editor-rects';

// ── Selection geometry (pre-freeze / unstable) ───────────────────────────────
// The selection shapes a decoration source or rect consumer reads: the
// `selectionChange` payload, its endpoint type, and the importable "through the
// block's last measurable position" sentinel `rangeRects` accepts as `end`.
export type { EditorSelection, SelectionPoint } from './selection/primitives';
export { SELECTION_END } from './block-component';
export type { SelectionEnd } from './block-component';
