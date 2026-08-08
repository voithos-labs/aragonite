/**
 * Svelte context-key symbols shared across the editor tree: three named facets
 * (services, policies, document) plus the per-key survivors whose granularity is
 * load-bearing — the action triple a container re-provides, HISTORY (G1.4's
 * single-provider subject), the scope-provided channels. Internal wiring, not a plugin
 * extension point; a facet object is not itself reactive, the getters it carries are.
 */

import type { Document } from './core/nodes';
import type { LinkReferenceResolver } from './core/inline/link-reference-resolver';
import type { ImageLoadPolicy } from './core/inline-render';
import type { UserScrollport } from './cursor/scroll-ancestors';
import type { PresentationMode } from './presentation-mode';
import type { KeybindingOverrideMap } from './schema/keybinding-overrides';
import type { EditorContext } from './schema/plugin-install';
import type { RegistryView } from './schema/registry-view';
import type { EditorRects } from './editor-rects';
import type { EditorEvents } from './editor-events';
import type { UndoController } from './editor-actions/deps';
import type { ReorderAction } from './editor-actions/reorder-action';
import type { PasteCommitCoordinator } from './tree-operations/paste/paste-deps';
import type { SelectionState } from './selection/selection-state.svelte';
import type { SearchState } from './search/search-state.svelte';
import type { DecorationEngine } from './decorations/decoration-state.svelte';
import type { StickyColumnState } from './cursor/sticky-column';
import type { EdgeAffinityState } from './cursor/edge-affinity';
import type { PendingMarksState } from './cursor/pending-marks';
import type { RevealAnchorState } from './cursor/reveal-anchor';
import type { HeightOracle } from './cursor/height-oracle';
import type { WidgetSelectionState } from './components/image/widget-selection-state.svelte';

// ── Shared value-shape types ─────────────────────────────────────────────────

export type ReorderAnnounce = (message: string) => void;
export type KeybindingOverridesGetter = () => KeybindingOverrideMap;
export type ResolveImageUrl = (rawUrl: string) => string;
export type ResolveLinkUrl = (rawUrl: string) => string;

/** One image file lifted off an image-bearing paste, handed to the host's import
 *  hook. `suggestedName` is the clipboard's filename when it carried one. */
export interface PastedImage {
	blob: Blob;
	mimeType: string;
	suggestedName?: string;
}

/** Host import hook for pasted images: resolves to the markdown to insert, or null
 *  to skip that image. Called once per image file, in clipboard order. */
export type PasteImageHook = (image: PastedImage) => Promise<string | null>;
export type PresentationModeGetter = () => PresentationMode;
/** The editor's theme name, as reflected to `data-editor-theme`. An open string:
 *  built-ins are `'dark'`/`'light'`, and a consumer may name its own. */
export type ThemeGetter = () => string;
export type PluginEditorLookup = (pluginName: string) => EditorContext;
export type BlockElLookup = (path: number[]) => HTMLElement | null;
export type DocumentGetter = () => Document;
export type FocusedPathGetter = () => number[] | null;
export type WidthVersionGetter = () => number;

/** Resolver ref read by inline parsers in block components. Wrapped in a `{ current }`
 *  accessor so the shell can rebuild it after each commit without invalidating
 *  descendants' getContext bindings. `epoch` is the compact stamp render memos key on
 *  instead of concatenating the whole (~MB-scale) `signature` every keystroke. */
export type LinkReferenceResolverRef = {
	current?: LinkReferenceResolver;
	signature?: string;
	epoch?: number;
};

// ── Action triple (per-key: containers re-provide these three) ───────────────

export const BLOCK_EDIT_KEY = Symbol('block-edit-actions');
export const FOCUS_KEY = Symbol('focus-actions');
export const CONTAINER_EDIT_KEY = Symbol('container-edit-actions');

/** G1.4's subject: only the editor root provides history, so undo/redo resolve to one
 *  stack. Folding it into a facet a container could re-provide is the exact violation. */
export const HISTORY_KEY = Symbol('history-actions');

// ── Scope-provided channels (per-key: scope provision IS their mechanism) ────

export const LIST_CONTEXT_KEY = Symbol('list-context');
export const TABLE_CONTEXT_KEY = Symbol('table-context');

/**
 * @internal A hosted block enrolls itself in its scope's batched measure pass.
 * `register` no-ops when the path isn't a direct child of the scope's depth (nested
 * hosts route to their own channel); `readHeight` is called inside the scope's
 * read-all-then-write batch, never inline. `measureOnResize` carries the observer's
 * border-box height so the scope can O(1)-gate and skip the no-op mount resize.
 */
export const RECORD_BLOCK_HEIGHT_KEY = Symbol('record-block-height');
export type BlockMeasureChannel = {
	register: (path: number[], index: number, id: string, readHeight: () => number) => () => void;
	measureNow: (id: string) => void;
	measureOnResize: (id: string, observedHeight: number) => void;
};

/**
 * @internal A child reports up to its parent scope: a nested CONTAINER pushes its box
 * subtotal by index, while a `display:contents` ROW (no box of its own) enrolls in the
 * batched measure pass instead, so a windowed table measures like every other scope.
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
	/** Which side of an adjacent hidden marker run the caret means; the write seams read
	 *  it and keep their own default when it answers null. */
	edgeAffinity: EdgeAffinityState;
	/** The constructs a collapsed-caret toggle promised the next insertion. Invalidated with
	 *  the affinity, spent by the typing and composition seats. */
	pendingMarks: PendingMarksState;
	revealAnchor: RevealAnchorState;
	widgetSelection: WidgetSelectionState;
	controller: UndoController;
	pasteCoordinator: PasteCommitCoordinator;
	reorder: ReorderAction;
	reorderAnnounce: ReorderAnnounce;
	/** The instance's resolution over the global block definitions, so a per-instance
	 *  enablement filter reaches the render path. */
	registryView: RegistryView;
	/** The instance's rect surface, delivered to every block component as a prop
	 *  so a block can measure/reveal/scroll by path through the one seam. */
	rects: EditorRects;
}

/** Host-supplied render/behavior policies. The getter members read live editor state
 *  on each call. */
export const EDITOR_POLICIES_KEY = Symbol('editor-policies');
export interface EditorPolicies {
	resolveImageUrl: ResolveImageUrl;
	resolveLinkUrl: ResolveLinkUrl;
	imageLoadPolicy: () => ImageLoadPolicy;
	/** Getter-wrapped set-once flag: render the mouse-only hover drag handle.
	 *  False hides it; keyboard reorder stays available regardless. */
	blockDragHandles: () => boolean;
	presentationMode: PresentationModeGetter;
	/** For a renderer that paints rather than styles: a plugin emitting its own colored
	 *  markup (a diagram SVG) cannot pick the theme up from CSS, so it needs the name. */
	theme: ThemeGetter;
	keybindingOverrides: KeybindingOverridesGetter;
	/** Set-once host import hook for image-bearing pastes. Required-nullable: a mount must
	 *  answer, and `undefined` deliberately leaves the paste on the text/plain path. */
	onPasteImage: PasteImageHook | undefined;
	/** Resolved image URLs that failed to load this session. One Set per instance, so a
	 *  failed load never suppresses another editor's broken-state recompute
	 *  (`components/image/widget-dom.ts`). */
	brokenImageUrls: Set<string>;
}

/** Document identity and the per-instance lookups that hang off it. */
export const EDITOR_DOC_KEY = Symbol('editor-doc');
export interface EditorDoc {
	doc: DocumentGetter;
	/** Changes whenever the document's bytes change — the only sound memo key over a
	 *  document whose `$state` proxy is mutated in place and never changes identity.
	 *  Lazy: reading it is what makes the editor compute it. */
	contentVersion: () => number;
	linkRef: LinkReferenceResolverRef;
	/** Resolves a plugin's per-instance EditorContext — the one identity onEditor
	 *  callbacks, global-command handlers, and BlockCommandContext.editor share. */
	pluginEditor: PluginEditorLookup;
	/** AbortSignal tied to the editor's mount lifetime; document-level listeners
	 *  observe it to tear down if the editor unmounts mid-operation. */
	lifetime: AbortSignal;
	editorRoot: () => HTMLElement | null;
	/** What a drag autoscrolls to reach more of this editor: the root in self mode, the
	 *  nearest USER-scrollable ancestor in host mode, null when the page's own viewport
	 *  scrolls. What BOUNDS the visible region is a separate answer held by the rect
	 *  surface — see `cursor/scroll-ancestors`. */
	scrollHost: () => UserScrollport | null;
	blockElLookup: BlockElLookup;
	/** Live getter for the focused block's full path; drives per-level VR pins. */
	focusedPath: FocusedPathGetter;
	/** Per-kind height oracle (root-constructed); read by nested windowing scopes. */
	heightOracle: HeightOracle;
	/** False in host-scroll mode: no viewport to window against, so every scope mounts all
	 *  its children. Set once at mount — a windowing scope reads it inside its window
	 *  derived, so a live prop read would make it a keystroke-path dependency. */
	windowingEnabled: () => boolean;
	/** Monotonic width-change counter the root bumps on an editor width resize, so
	 *  every windowing scope rebuilds its model and re-measures at the new width. */
	widthVersion: WidthVersionGetter;
}
