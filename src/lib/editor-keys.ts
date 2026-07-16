/**
 * Svelte context-key symbols shared across the editor tree, plus the
 * value-shape types for the keys that have a stable contract (lookup
 * helpers — action interfaces are typed at the getContext site).
 *
 * Internal: these symbols are editor-internal wiring, not a plugin extension
 * point. The supported extension surface is the `aragonite/plugin` barrel.
 */

import type { Document } from './core/nodes';
import type { LinkReferenceResolver } from './core/inline/link-reference-resolver';
import type { PresentationMode } from './presentation-mode';
import type { KeybindingOverrideMap } from './schema/keybinding-overrides';
import type { EditorContext } from './schema/plugin-install';

export const LIST_CONTEXT_KEY = Symbol('list-context');

export const TABLE_CONTEXT_KEY = Symbol('table-context');

export const STICKY_COLUMN_KEY = Symbol('sticky-column');
export const REVEAL_ANCHOR_KEY = Symbol('reveal-anchor');

export const BLOCK_EDIT_KEY = Symbol('block-edit-actions');
export const FOCUS_KEY = Symbol('focus-actions');
export const HISTORY_KEY = Symbol('history-actions');
export const CONTAINER_EDIT_KEY = Symbol('container-edit-actions');

/** Sibling-reorder action shared by the keyboard nudge and the drag handle. */
export const REORDER_ACTION_KEY = Symbol('reorder-action');

/** Announce a reorder into the editor's polite live region. Shared so the
 *  table-row path (which bypasses the generic reorder action) reuses the one
 *  `.editor-sr-live-reorder` region instead of growing a second channel. */
export const REORDER_ANNOUNCE_KEY = Symbol('reorder-announce');
export type ReorderAnnounce = (message: string) => void;

/** Getter-wrapped set-once flag: render the mouse-only hover drag handle. False
 *  hides it; keyboard reorder stays available regardless. */
export const BLOCK_DRAG_HANDLES_KEY = Symbol('block-drag-handles');

/** Per-instance keybinding overrides, getter-wrapped so dispatch sites read the latest derived map. */
export const KEYBINDING_OVERRIDES_KEY = Symbol('keybinding-overrides');
export type KeybindingOverridesGetter = () => KeybindingOverrideMap;

export const SELECTION_KEY = Symbol('selection');

export const SEARCH_KEY = Symbol('search');

export const DECORATIONS_KEY = Symbol('decorations');

export const WIDGET_SELECTION_KEY = Symbol('widget-selection');

export const RESOLVE_IMAGE_URL_KEY = Symbol('resolve-image-url');
export type ResolveImageUrl = (rawUrl: string) => string;

export const RESOLVE_LINK_URL_KEY = Symbol('resolve-link-url');
export type ResolveLinkUrl = (rawUrl: string) => string;

export const IMAGE_LOAD_POLICY_KEY = Symbol('image-load-policy');

/** Getter-wrapped live EFFECTIVE presentation mode (preview stubs collapsed to
 *  'source'); render paths read it into their render keys so a mode flip
 *  re-renders every mounted block. */
export const PRESENTATION_MODE_KEY = Symbol('presentation-mode');
export type PresentationModeGetter = () => PresentationMode;

/**
 * Per-editor cache of resolved image URLs that failed to load this session.
 * Mutable runtime state — one Set per editor instance so a failed load in one
 * editor never suppresses another's broken-state recompute. See
 * `components/image/widget-dom.ts` for why the cache exists.
 */
export const BROKEN_IMAGE_URLS_KEY = Symbol('broken-image-urls');

/** Internal — editor event seam handed to BlockHost's error boundary. Not a plugin extension point. */
export const EDITOR_EVENTS_KEY = Symbol('editor-events');

/** Resolves a plugin's per-instance EditorContext — the one identity onEditor
 *  callbacks, global-command handlers, and BlockCommandContext.editor all share. */
export const PLUGIN_EDITOR_KEY = Symbol('plugin-editor-context');
export type PluginEditorLookup = (pluginName: string) => EditorContext;

export const EDITOR_ROOT_KEY = Symbol('editor-root');

/**
 * AbortSignal tied to the editor's mount lifetime. Document-level listeners
 * (drag-pointer, etc.) observe this to tear themselves down if the editor
 * unmounts mid-operation.
 */
export const EDITOR_LIFETIME_KEY = Symbol('editor-lifetime');

export const CONTROLLER_KEY = Symbol('undo-controller');

/** Narrow paste-side view of the controller; supplied so paste call sites depend on the explicit interface. */
export const PASTE_COORDINATOR_KEY = Symbol('paste-coordinator');

export const BLOCK_EL_LOOKUP_KEY = Symbol('block-el-lookup');
export type BlockElLookup = (path: number[]) => HTMLElement | null;

/** Getter-wrapped so block components always read the latest reactive Document. */
export const DOC_KEY = Symbol('editor-doc');
export type DocumentGetter = () => Document;

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

/** @internal Live getter for the focused block's full path; drives per-level VR pins. */
export const FOCUSED_PATH_KEY = Symbol('focused-path');
export type FocusedPathGetter = () => number[] | null;

/**
 * @internal Monotonic counter the editor root bumps when its scroll element's WIDTH
 * changes (a `ResizeObserver` on `.editor`). Prose re-wraps at a new width, so every
 * windowing scope reads it to rebuild its model and re-measure mounted blocks at the
 * new width. Sourced once at the root; height-only resizes don't bump it.
 */
export const WIDTH_VERSION_KEY = Symbol('width-version');
export type WidthVersionGetter = () => number;

/** @internal Per-kind height oracle (Editor-constructed); read by nested windowing scopes. */
export const HEIGHT_ORACLE_KEY = Symbol('height-oracle');
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

/** Resolver ref read by inline parsers in block components. Wrapped in a
 *  `{ current }` accessor so the shell can rebuild the resolver after each
 *  commit without invalidating descendants' getContext bindings. `signature`
 *  is the LRD-set snapshot that reference-bearing render memos key on so they
 *  re-render when a definition elsewhere changes. */
export const LINK_REF_KEY = Symbol('link-ref');
export type LinkReferenceResolverRef = { current?: LinkReferenceResolver; signature?: string };
