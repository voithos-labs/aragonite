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

// ── Parser-opener registry ───────────────────────────────────────────────────
export { registerBlockOpener } from './schema/block-openers';
export type { BlockOpener, OpenContext } from './schema/block-openers';

// ── Command registry ─────────────────────────────────────────────────────────
export { registerCommand } from './schema/commands';
export type { CommandId, GlobalCommandContext } from './schema/commands';
