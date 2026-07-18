/**
 * Svelte context-key symbols shared across the editor tree.
 *
 * The block↔editor interface rides three named facets — services, policies,
 * document — plus the per-key survivors whose individual granularity is
 * load-bearing: the action triple a container re-provides, HISTORY (G1.4's
 * single-provider subject), and the scope-provided list/table/measure channels.
 * Each facet is ONE key holding a plain object of the values the root provides
 * once; getters stay getters and bundles stay bundles, and the facet object
 * itself is not reactive — the reactivity lives in the getters it carries.
 *
 * Internal: these symbols are editor-internal wiring, not a plugin extension
 * point. The supported extension surface is the `aragonite/plugin` barrel.
 */

import type { Document } from './core/nodes';
import type { LinkReferenceResolver } from './core/inline/link-reference-resolver';
import type { ImageLoadPolicy } from './core/inline-render';
import type { PresentationMode } from './presentation-mode';
import type { KeybindingOverrideMap } from './schema/keybinding-overrides';
import type { EditorContext } from './schema/plugin-install';
import type { RegistryView } from './schema/registry-view';
import type { EditorEvents } from './editor-events';
import type { UndoController } from './editor-actions/deps';
import type { ReorderAction } from './editor-actions/reorder-action';
import type { PasteCommitCoordinator } from './tree-operations/paste/paste-deps';
import type { SelectionState } from './selection/selection-state.svelte';
import type { SearchState } from './search/search-state.svelte';
import type { DecorationEngine } from './decorations/decoration-state.svelte';
import type { StickyColumnState } from './cursor/sticky-column';
import type { RevealAnchorState } from './cursor/reveal-anchor';
import type { HeightOracle } from './cursor/height-oracle';
import type { WidgetSelectionState } from './components/image/widget-selection-state.svelte';

// ── Shared value-shape types ─────────────────────────────────────────────────

export type ReorderAnnounce = (message: string) => void;
export type KeybindingOverridesGetter = () => KeybindingOverrideMap;
export type ResolveImageUrl = (rawUrl: string) => string;
export type ResolveLinkUrl = (rawUrl: string) => string;
export type PresentationModeGetter = () => PresentationMode;
export type PluginEditorLookup = (pluginName: string) => EditorContext;
export type BlockElLookup = (path: number[]) => HTMLElement | null;
export type DocumentGetter = () => Document;
export type FocusedPathGetter = () => number[] | null;
export type WidthVersionGetter = () => number;

/** Resolver ref read by inline parsers in block components. Wrapped in a
 *  `{ current }` accessor so the shell can rebuild the resolver after each
 *  commit without invalidating descendants' getContext bindings. `signature`
 *  is the LRD-set snapshot that reference-bearing render memos key on so they
 *  re-render when a definition elsewhere changes. */
export type LinkReferenceResolverRef = { current?: LinkReferenceResolver; signature?: string };

// ── Action triple (per-key: containers re-provide these three) ───────────────

export const BLOCK_EDIT_KEY = Symbol('block-edit-actions');
export const FOCUS_KEY = Symbol('focus-actions');
export const CONTAINER_EDIT_KEY = Symbol('container-edit-actions');

/** G1.4's subject: only the editor root provides history, so undo/redo resolve
 *  to one stack. Folding it into a facet a container could re-provide is the
 *  exact violation — it stays its own key, individually distinguishable. */
export const HISTORY_KEY = Symbol('history-actions');

// ── Scope-provided channels (per-key: scope provision IS their mechanism) ────

export const LIST_CONTEXT_KEY = Symbol('list-context');
export const TABLE_CONTEXT_KEY = Symbol('table-context');

/**
 * @internal A hosted block enrolls itself in its scope's batched measure pass.
 * `register` returns an unregister fn (or a no-op when the path isn't a direct child
 * of the scope's depth — nested hosts route to their own scope's channel); `readHeight`
 * is called inside the scope's read-all-then-write batch, never inline. `measureNow`
 * re-measures just this block after an edit (one block, not the thrash path).
 * `measureOnResize` is the ResizeObserver path for async growth (an image decoding in):
 * it carries the observer-reported border-box height so the scope can O(1)-gate against
 * the height it already recorded and skip the expensive re-measure on the no-op mount
 * resize — the fling case — touching the DOM only on a genuine post-mount change.
 */
export const RECORD_BLOCK_HEIGHT_KEY = Symbol('record-block-height');
export type BlockMeasureChannel = {
	register: (path: number[], index: number, id: string, readHeight: () => number) => () => void;
	measureNow: (id: string) => void;
	measureOnResize: (id: string, observedHeight: number) => void;
};

/**
 * @internal A child reports up to its parent scope. A nested CONTAINER pushes its own
 * box subtotal by index (`setChildSubtotal`). A `display:contents` ROW (no box of its
 * own) instead enrolls in the scope's batched measure pass via `registerRow` — its
 * `readHeight` reads a cell, `applyHeight` is `setChildSubtotal` — so a windowed table
 * measures its rows read-all-then-write like every other scope.
 */
export const PARENT_SCOPE_SINK_KEY = Symbol('parent-scope-sink');
export type ParentScopeSink = {
	setChildSubtotal: (index: number, total: number) => void;
	registerRow: (
		id: string,
		readHeight: () => number,
		applyHeight: (h: number) => void
	) => () => void;
	measureRowNow: (id: string) => void;
};

// ── Facets ───────────────────────────────────────────────────────────────────

/** Cross-cutting editor services: event seam, view-state stores, and the
 *  cross-scope commit/reorder primitives. Root-provided once. */
export const EDITOR_SERVICES_KEY = Symbol('editor-services');
export interface EditorServices {
	events: EditorEvents;
	decorations: DecorationEngine;
	selection: SelectionState;
	search: SearchState;
	stickyColumn: StickyColumnState;
	revealAnchor: RevealAnchorState;
	widgetSelection: WidgetSelectionState;
	controller: UndoController;
	pasteCoordinator: PasteCommitCoordinator;
	reorder: ReorderAction;
	reorderAnnounce: ReorderAnnounce;
	/** The instance's resolution over the global block definitions:
	 *  BlockHost resolves component/descriptor through it so a per-instance
	 *  enablement filter reaches the render path. */
	registryView: RegistryView;
}

/** Host-supplied render/behavior policies: URL resolution, load and drag-handle
 *  gates, presentation mode, keybinding overrides, and the broken-image cache.
 *  The getter members read live editor state on each call. */
export const EDITOR_POLICIES_KEY = Symbol('editor-policies');
export interface EditorPolicies {
	resolveImageUrl: ResolveImageUrl;
	resolveLinkUrl: ResolveLinkUrl;
	imageLoadPolicy: () => ImageLoadPolicy;
	/** Getter-wrapped set-once flag: render the mouse-only hover drag handle.
	 *  False hides it; keyboard reorder stays available regardless. */
	blockDragHandles: () => boolean;
	presentationMode: PresentationModeGetter;
	keybindingOverrides: KeybindingOverridesGetter;
	/** Per-editor cache of resolved image URLs that failed to load this session —
	 *  one Set per instance so a failed load never suppresses another editor's
	 *  broken-state recompute (`components/image/widget-dom.ts`). */
	brokenImageUrls: Set<string>;
}

/** Document identity and the per-instance lookups that hang off it: the live
 *  doc getter, link-reference resolver ref, plugin-context resolver, mount
 *  lifetime, DOM anchors, and the windowing oracle/version signals. */
export const EDITOR_DOC_KEY = Symbol('editor-doc');
export interface EditorDoc {
	doc: DocumentGetter;
	linkRef: LinkReferenceResolverRef;
	/** Resolves a plugin's per-instance EditorContext — the one identity onEditor
	 *  callbacks, global-command handlers, and BlockCommandContext.editor share. */
	pluginEditor: PluginEditorLookup;
	/** AbortSignal tied to the editor's mount lifetime; document-level listeners
	 *  observe it to tear down if the editor unmounts mid-operation. */
	lifetime: AbortSignal;
	editorRoot: () => HTMLElement | null;
	blockElLookup: BlockElLookup;
	/** Live getter for the focused block's full path; drives per-level VR pins. */
	focusedPath: FocusedPathGetter;
	/** Per-kind height oracle (root-constructed); read by nested windowing scopes. */
	heightOracle: HeightOracle;
	/** Monotonic width-change counter the root bumps on an editor width resize, so
	 *  every windowing scope rebuilds its model and re-measures at the new width. */
	widthVersion: WidthVersionGetter;
}
