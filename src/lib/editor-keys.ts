/**
 * Svelte context-key symbols shared across the editor tree, plus the
 * value-shape types for the keys that have a stable contract (lookup
 * helpers — action interfaces are typed at the getContext site).
 */

import type { Document } from './core/nodes';
import type { WidgetSelectionState } from './components/image/widget-selection-state.svelte';

export const LIST_CONTEXT_KEY = Symbol('list-context');

export const TABLE_CONTEXT_KEY = Symbol('table-context');

export const STICKY_COLUMN_KEY = Symbol('sticky-column');

export const BLOCK_EDIT_KEY = Symbol('block-edit-actions');
export const FOCUS_KEY = Symbol('focus-actions');
export const HISTORY_KEY = Symbol('history-actions');
export const CONTAINER_EDIT_KEY = Symbol('container-edit-actions');

export const SELECTION_KEY = Symbol('selection');

export const WIDGET_SELECTION_KEY = Symbol('widget-selection');
export type { WidgetSelectionState };

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
