// The plugin-authoring surface, published at the `aragonite/plugin` subpath. Only the
// authoring API belongs here — not the `<Editor>` embedding barrel (index.ts), no test
// helpers, no internal dispatch. Sections tagged (pre-freeze) may change until the 1.0
// freeze.

import TextEditableBlock from './components/blocks/text/TextEditableBlock.svelte';
import { registerChromeLeaf as bindChromeLeaf } from './editor-actions/plugin/chrome-leaf';
import { computeInlineContent as parseLeafInline } from './core/inline';
import type { AnyBlockKind, InlineNode } from './core/nodes';
import type { NodeView } from './core/node-views';
import type { ChromeLeafOptions } from './editor-actions/plugin/chrome-leaf';

// ── Plugin unit (pre-freeze) ─────────────────────────────────────────────────
// Installation is once per process — the editor's `plugins` prop does it, so a
// consumer rarely calls installPlugins directly.
export { definePlugin, isPluginInstalled } from './schema/plugin-install';
export type { EditorPlugin, EditorPluginEntry } from './schema/plugin-install';
// `setup(ctx)` registers `onEditor` callbacks that receive a per-instance EditorContext.
export type { PluginSetupContext, OnEditorCallback, EditorContext } from './schema/plugin-install';
// The vocabulary every mode read reports, the `data-presentation` root attribute included.
export type { PresentationMode } from './presentation-mode';
// The single-block shortcut: one kind, one component, one register step.
export { definePluginBlock } from './schema/define-plugin-block';

// ── Kind declaration ─────────────────────────────────────────────────────────
export { declarePluginKind, declaredPluginKind } from './schema/plugin-kind';
export type { PluginBlockKind, AnyBlockKind } from './core/nodes';

// ── Inline authoring surface (pre-freeze) ────────────────────────────────────
// Mint an inline kind, hook the scanner on a trigger character, register a live atomic widget.
export {
	declarePluginInlineKind,
	declaredPluginInlineKind,
	isInlineKindDeclared
} from './schema/plugin-kind';
export type { PluginInlineKind, InlineNode, ImageFields, ImageSyntaxRewriter } from './core/nodes';
export { registerInlineSyntax, INLINE_PRIORITIES } from './core/inline/scan/plugin-syntax';
export type { InlineSyntaxRecognizer, InlineSyntaxOptions } from './core/inline/scan/plugin-syntax';
export { registerInlineWidgetKind, mintWidgetShell } from './core/inline/inline-widgets';
export type {
	InlineWidgetDescriptor,
	InlineWidgetComponentProps,
	InlineWidgetEditingPolicy,
	InlineWidgetEditingContext
} from './core/inline/inline-widgets';

// ── Block-kind descriptor registry ───────────────────────────────────────────
// BlockKindRegistration is the write-side shape; BlockKindDescriptor is the flat
// read-side one, still exported as the referent of ContainerDescriptorGroup's fields.
export { registerBlockKind, augmentBlockKind } from './schema/block-kind-descriptor';
export type {
	BlockKindDescriptor,
	BlockKindRegistration,
	BlockKindAugmentation,
	ContainerDescriptorGroup,
	MergeRole,
	UnwrapRole
} from './schema/block-kind-descriptor';
// The required closure block a registration answers every cross-cutting system with.
// `simpleLeafClosure`/`containerClosure` bake their tier's fixed columns over that field.
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
// The built-in priority ladder a plugin opener prices against (pre-freeze) — see the
// plugin guide's opener-priority section for the two placement rules.
export { OPENER_PRIORITIES } from './schema/opener-priorities';

// ── Enter-completion registry (pre-freeze) ───────────────────────────────────
// The opener's sibling for a grammar whose lines must be adjacent, which Enter alone can
// never type into existence: a completer reads one typed line and answers the lines that
// complete it, plus where the caret seats inside the mint.
export { registerBlockCompleter } from './schema/block-completions';
export type { BlockCompleter, CompletionResult } from './schema/block-completions';

// ── Command vocabulary + keybindings (pre-freeze) ────────────────────────────
// The built-in half; a plugin's own commands are minted in the section below.
export type { CommandId } from './schema/commands';
export type { KeyBinding } from './schema/keybindings';

// ── Command mint (pre-freeze) ────────────────────────────────────────────────
// A (kind, name) block-command mints a PluginCommandId; AnyCommandId spans built-in and minted.
export { registerBlockCommand } from './schema/block-commands';
export type { BlockCommandContext, BlockCommandHandler } from './schema/block-commands';
export type { PluginCommandId, AnyCommandId } from './schema/command-id';
// A global command is process-wide but runs against the dispatching instance's EditorContext.
export { registerGlobalCommand } from './schema/global-commands';

// ── Parse / serialize helpers (pre-freeze) ───────────────────────────────────
// Re-exported so an opener needn't reach into core/ deep paths the packaged artifact
// doesn't expose.
export { parse, type ParseScope } from './core/parser';
export type { Document } from './core/nodes';
export { serialize, concatChildren as serializeChildren } from './core/serializer';
export { trimTrailingLineEnding, normalizeLineEndings } from './core/lines';
// The `ParsedLine[]` every line-scoped seam here consumes — without it a `source →
// source` transform holding nothing but a string could not reach `blockquoteExtent`.
export { splitLines } from './core/lines';
export type { ParsedLine } from './core/lines';
// GFM §2.1's blank line (spaces and tabs only). `String.trim()` would admit the whole
// Unicode whitespace set and split a block on a pasted non-breaking space.
export { isBlankLine } from './core/parser';
// A container whose body sits between chrome lines of its own (`:::note` … `:::`,
// `<summary>` … `</details>`) parses that body here, not with `parse`: the blank line
// against a chrome line is a separator, and only this seam knows to keep it out of the
// children. See `design/syntax-tree.md` § blank lines.
export { parseContainerBody } from './core/parser';
export type { ContainerBodyWrap } from './core/parser';

// ── Fence grammar (pre-freeze) ───────────────────────────────────────────────
// The built-in CommonMark fence recognizers, so a plugin claiming a fence (```mermaid)
// never reimplements the rules. The opener match keeps verbatim indent/info bytes, for
// byte-exact rebuilds.
export { matchFenceOpen, matchFenceClose } from './core/parsers/fence-syntax';
export type { FenceOpen } from './core/parsers/fence-syntax';

// ── HTML tag-line grammar (pre-freeze) ───────────────────────────────────────
// CommonMark's type-6 tag-line shape for one tag name. What actually closes such a
// container is everything the spec passes through raw (indented, upper-cased, trailing
// space) — looser than any canonical form a rebuild emits.
export { htmlBlockTagLineMatcher } from './core/parsers/html-block';

// ── Blockquote grammar (pre-freeze) ──────────────────────────────────────────
// The built-in blockquote extent scanner, so a plugin claiming a blockquote-shaped
// construct (`> [!NOTE]`) reuses CommonMark §5.1 lazy continuation instead of forking it.
export { blockquoteExtent } from './core/parsers/blockquote';

// ── CST node access (pre-freeze; the metadata pair below is stable) ──────────
export type { CstNode } from './core/nodes';
// Reads get bytes-readonly views; CstNode/Document stay the types a plugin CONSTRUCTS
// (openers, factories, rebuildRaw), which stay mutable.
export type { NodeView, DocumentView } from './core/node-views';
// Store/read a plugin kind's own metadata shape without casting through `BlockMetadata`.
export { setPluginMetadata, getPluginMetadata } from './core/nodes';
// The content span within a block's raw, syntax markers excluded (a heading's `#` prefix).
export { getContentRange } from './core/inline';
export type { ContentRange } from './core/inline';
// A heading's level (ATX or setext), null otherwise: the typed path past the
// built-in-node narrowing this barrel keeps internal.
export { headingLevel } from './core/nodes';
// Pure and uncached — the reactive-safe path a widget's `$derived` reads. `isProseKind`
// gates the walk so a code block's bytes are never inline-scanned.
export { isProseKind } from './core/inline';

/**
 * Inline-parse a prose leaf. No link-reference resolver is available to a plugin, so
 * reference links parse as `unresolvedReference`; every other construct fully resolves.
 */
export function computeInlineContent(node: NodeView): InlineNode[] {
	return parseLeafInline(node);
}

// ── Idempotent-registration probes ─────────────────────────────────────────────
// The register-once registries throw on duplicate; a plugin re-registers safely
// (HMR / re-import) by guarding on these.
export { isBlockKindDeclared } from './schema/plugin-kind';
export { isBlockKindRegistered } from './schema/block-kind-descriptor';
export { isBlockComponentRegistered } from './schema/block-component-registry';
export { isBlockOpenerRegistered } from './schema/block-openers';
export { isBlockCompleterRegistered } from './schema/block-completions';
export { isPasteTransformRegistered } from './tree-operations/paste/paste-transforms';

// ── Container-authoring surface (pre-freeze) ─────────────────────────────────
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
// The one seam allowed to import components/, so editor-actions keeps no upward
// value edge to the component tree.
export function registerChromeLeaf(kind: AnyBlockKind, opts?: ChromeLeafOptions): void {
	bindChromeLeaf(kind, TextEditableBlock, opts);
}
export type { ChromeLeafOptions };
// Mint the reserved child-0 node for a container's chrome leaf: text plus its newline.
export { chromeChild } from './editor-actions/plugin/chrome-leaf';
// One definition of collapsed, shared by a component's getter and the model-layer walks.
export { isCollapsedContainer } from './schema/reserved-chrome';

// ── Editable-leaf authoring surface (pre-freeze) ─────────────────────────────
// A text-editing leaf with native caret/IME/undo/selection parity, plain (per-keystroke
// commits) or render-primary (reveal-to-edit, one commit on blur). The
// createContainerBlock sibling for leaves.
export { createEditableLeaf } from './components/blocks/editable-leaf';
export type {
	EditableLeaf,
	EditableLeafDeps,
	EditableLeafMode,
	EditableLeafSurfaceProps
} from './components/blocks/editable-leaf';
export type { StickyColumnDirection } from './block-component';

// ── Directive authoring (pre-freeze) ─────────────────────────────────────────
// `activateDirectives()` claims `:::` — call it once at startup, before the editor
// parses. The other symbols are inert: importing them does NOT claim the grammar.
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
// so the editor's separator settle knows the blank line against the fence belongs to the fence.
export { DIRECTIVE_BODY_WRAP } from './core/directive/kinds';

// ── Renderer utilities (pre-freeze) ──────────────────────────────────────────
// A bounded LRU memo for a renderer's per-source work, sync or async (store the
// promise). See the plugin guide's renderer recipe.
export { createBoundedMemo } from './bounded-memo';
export type { BoundedMemoOptions } from './bounded-memo';

// ── Paste transforms (pre-freeze) ────────────────────────────────────────────
// A pre-parse clipboard rewrite: inspect the raw pasted text, replace it or decline
// (null). Transforms run in install order at every paste site — never on load or typing.
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

// ── Rects (pre-freeze) ───────────────────────────────────────────────────────
// Viewport-space geometry over the rendered document, reached through `editor.rects`.
export type { EditorRects } from './editor-rects';

// ── Selection geometry (pre-freeze) ──────────────────────────────────────────
// The selection shapes a decoration source or rect consumer reads. SELECTION_END is
// the sentinel `rangeRects` accepts as `end`.
export type { EditorSelection, SelectionPoint } from './selection/primitives';
export { SELECTION_END } from './block-component';
export type { SelectionEnd } from './block-component';
