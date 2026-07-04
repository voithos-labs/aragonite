// The plugin-authoring surface, published at the `aragonite/plugin` subpath.
// Separate from the `<Editor>` consumer barrel (index.ts) on purpose: this is the
// authoring API, not the embedding API. Only the authoring surface belongs here —
// no test helpers, no internal getters or dispatch.

import TextEditableBlock from './components/blocks/text/TextEditableBlock.svelte';
import { registerChromeLeaf as bindChromeLeaf } from './editor-actions/plugin/chrome-leaf';
import type { AnyBlockKind } from './core/nodes';
import type { ChromeLeafOptions } from './editor-actions/plugin/chrome-leaf';

// ── Kind declaration ─────────────────────────────────────────────────────────
export { declarePluginKind, declaredPluginKind } from './schema/plugin-kind';
export type { PluginBlockKind, AnyBlockKind } from './core/nodes';

// ── Block-kind descriptor registry ───────────────────────────────────────────
export { registerBlockKind, augmentBlockKind } from './schema/block-kind-descriptor';
export type { BlockKindDescriptor, MergeRole, UnwrapRole } from './schema/block-kind-descriptor';

// ── Component registry ───────────────────────────────────────────────────────
export { registerBlockComponent, defineBlockComponent } from './schema/block-component-registry';
export type { BlockComponentEntry } from './schema/block-component-registry';
export type { BlockComponent, BlockComponentProps } from './block-component';

// ── Parser-opener registry ───────────────────────────────────────────────────
export { registerBlockOpener } from './schema/block-openers';
export type { BlockOpener, OpenContext } from './schema/block-openers';

// ── Command vocabulary + keybindings ─────────────────────────────────────────
// CommandId names the built-in command a keymap binding targets; KeyBinding is
// the per-kind chord→command shape. The command-registration surface stays off
// this barrel until the command mint lands (roadmap 1).
export type { CommandId } from './schema/commands';
export type { KeyBinding } from './schema/keybindings';

// ── Parse / serialize helpers ────────────────────────────────────────────────
// The recognizer/serializer halves of an opener: parse a body to a Document,
// join child bytes back, and read a child's display text without dropping a CRLF.
// Re-exported here so an opener needn't reach into core/ deep paths that the
// packaged artifact doesn't expose.
export { parse } from './core/parser';
export type { Document } from './core/nodes';
export { concatChildren as serializeChildren } from './core/serializer';
export { trimTrailingLineEnding } from './core/lines';
export type { ParsedLine } from './core/lines';

// ── CST node access ────────────────────────────────────────────────────────────
export type { CstNode } from './core/nodes';
// Typed plugin metadata: store/read a plugin kind's own shape without casting
// through the built-in `BlockMetadata` union at the call site.
export { setPluginMetadata, getPluginMetadata } from './core/nodes';

// ── Idempotent-registration probes ─────────────────────────────────────────────
// The register-once registries throw on duplicate; a plugin re-registers safely
// (HMR / re-import) by guarding on these.
export { isBlockKindRegistered } from './schema/block-kind-descriptor';
export { isBlockComponentRegistered } from './schema/block-component-registry';

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
// Reads the descriptor's `reservedChrome.isCollapsed` probe, so a component's
// collapse getter and the model-layer walks share one definition.
export { isCollapsedContainer } from './schema/reserved-chrome';
