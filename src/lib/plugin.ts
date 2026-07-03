// The frozen plugin-authoring surface, published at the `aragonite/plugin` subpath.
// Separate from the `<Editor>` consumer barrel (index.ts) on purpose: this is the
// authoring API, not the embedding API. Only the stable registration surface belongs
// here — no test helpers, no internal getters or dispatch.

// ── Kind declaration ─────────────────────────────────────────────────────────
export { declarePluginKind } from './schema/plugin-kind';
export type { PluginBlockKind, AnyBlockKind } from './core/nodes';

// ── Block-kind descriptor registry ───────────────────────────────────────────
export { registerBlockKind, augmentBlockKind } from './schema/block-kind-descriptor';
export type { BlockKindDescriptor, MergeRole, UnwrapRole } from './schema/block-kind-descriptor';

// ── Component registry ───────────────────────────────────────────────────────
export { registerBlockComponent, defineBlockComponent } from './schema/block-component-registry';
export type { BlockComponentEntry } from './schema/block-component-registry';
export type { BlockComponent } from './block-component';

// ── Parser-opener registry ───────────────────────────────────────────────────
export { registerBlockOpener } from './schema/block-openers';
export type { BlockOpener, OpenContext } from './schema/block-openers';

// ── Command registry ─────────────────────────────────────────────────────────
export { registerCommand } from './schema/commands';
export type { CommandId, GlobalCommandContext } from './schema/commands';

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
export { createContainerBlock } from './editor-actions/plugin-container';
export type {
	ContainerBlock,
	ContainerBlockDeps,
	ContainerBlockListProps
} from './editor-actions/plugin-container';
export { registerChromeLeaf } from './editor-actions/plugin-chrome-leaf';
export type { ChromeLeafOptions } from './editor-actions/plugin-chrome-leaf';
// Reads the descriptor's `reservedChrome.isCollapsed` probe, so a component's
// collapse getter and the model-layer walks share one definition.
export { isCollapsedContainer } from './schema/reserved-chrome';
