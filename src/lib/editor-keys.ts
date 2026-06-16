/**
 * Svelte context-key symbols shared across the editor tree, plus the
 * value-shape types for the keys that have a stable contract (lookup
 * helpers — action interfaces are typed at the getContext site).
 *
 * Internal: these symbols are editor-internal wiring, not a plugin extension
 * point. The supported extension surface is the 1.2 plugin API.
 */

import type { Document } from './core/nodes';
import type { LinkReferenceResolver } from './core/inline/link-reference-resolver';
import type { WidgetSelectionState } from './components/image/widget-selection-state.svelte';
import type { BlockComponent } from './block-component';

export const LIST_CONTEXT_KEY = Symbol('list-context');

export const TABLE_CONTEXT_KEY = Symbol('table-context');

export const STICKY_COLUMN_KEY = Symbol('sticky-column');

export const BLOCK_EDIT_KEY = Symbol('block-edit-actions');
export const FOCUS_KEY = Symbol('focus-actions');
export const HISTORY_KEY = Symbol('history-actions');
export const CONTAINER_EDIT_KEY = Symbol('container-edit-actions');

export const SELECTION_KEY = Symbol('selection');
export type { EditorSelection } from './selection/primitives';

export const WIDGET_SELECTION_KEY = Symbol('widget-selection');
export type { WidgetSelectionState };

export const RESOLVE_IMAGE_URL_KEY = Symbol('resolve-image-url');
export type ResolveImageUrl = (rawUrl: string) => string;

export const RESOLVE_LINK_URL_KEY = Symbol('resolve-link-url');
export type ResolveLinkUrl = (rawUrl: string) => string;

export const IMAGE_LOAD_POLICY_KEY = Symbol('image-load-policy');

/** Internal — editor event seam handed to BlockHost's error boundary. Not a plugin extension point. */
export const EDITOR_EVENTS_KEY = Symbol('editor-events');

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

/**
 * Path → BlockComponent lookup. Parallel to BLOCK_EL_LOOKUP_KEY, but returns
 * the live view-layer ref so callers can consult component-side predicates
 * (e.g. isVerticallyTransparent) when routing cross-block focus.
 */
export const BLOCK_COMPONENT_LOOKUP_KEY = Symbol('block-component-lookup');
export type BlockComponentLookup = (path: number[]) => BlockComponent | null;

/** Getter-wrapped so block components always read the latest reactive Document. */
export const DOC_KEY = Symbol('editor-doc');
export type DocumentGetter = () => Document;

/** @internal Reports a block's measured (post-layout) height for virtual rendering; provided by Editor. */
export const RECORD_BLOCK_HEIGHT_KEY = Symbol('record-block-height');
export type RecordBlockHeight = (path: number[], id: string, height: number) => void;

/** @internal Live getter for the focused block's full path; drives per-level VR pins. */
export const FOCUSED_PATH_KEY = Symbol('focused-path');
export type FocusedPathGetter = () => number[] | null;

/** @internal Per-kind height oracle (Editor-constructed); read by nested windowing scopes. */
export const HEIGHT_ORACLE_KEY = Symbol('height-oracle');
/** @internal A scope's setChildSubtotal — a child container reports its own box subtotal up by index. */
export const PARENT_SCOPE_SINK_KEY = Symbol('parent-scope-sink');
export type ParentScopeSink = { setChildSubtotal: (index: number, total: number) => void };

/** Resolver ref read by inline parsers in block components. Wrapped in a
 *  `{ current }` accessor so the shell can rebuild the resolver after each
 *  commit without invalidating descendants' getContext bindings. `signature`
 *  is the LRD-set snapshot that reference-bearing render memos key on so they
 *  re-render when a definition elsewhere changes. */
export const LINK_REF_KEY = Symbol('link-ref');
export type LinkReferenceResolverRef = { current?: LinkReferenceResolver; signature?: string };
