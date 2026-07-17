/**
 * Composer for container nestedActions bundles — produces a complete
 * { blockEdit, focus, containerEdit } triple from a state bundle and the
 * container's raw rebuild. HistoryActions is deliberately absent: containers
 * never override history; Svelte context delivers the document-level
 * HISTORY_KEY to any descendant.
 */

import { setContext } from 'svelte';
import type {
	BlockEditActions,
	ContainerEditActions,
	FocusActions,
	ListContext
} from '../../action-contracts';
import type { NodeView } from '../../core/node-views';
import { BLOCK_EDIT_KEY, CONTAINER_EDIT_KEY, FOCUS_KEY, HISTORY_KEY } from '../../editor-keys';
import { assertInvariant } from '../../invariants/assert';
import { checkNoContainerHistoryKey } from '../../invariants/context-keys';
import type { StickyColumnState } from '../../cursor/sticky-column';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import { createNestedBlockEdit } from './nested-block-edit';
import { createNestedFocus } from './nested-focus';

export interface NestedActionsBundle {
	blockEdit: BlockEditActions;
	focus: FocusActions;
	containerEdit: ContainerEditActions;
}

export interface NestedActionsDeps {
	index: number;
	node: NodeView;
	/** Doc-absolute path of `node`; spine unsharing + ancestry rebuilds key off it. */
	path: number[];
	stickyColumn: StickyColumnState;
	/** Enclosing list's context, when this container is a list nested in one. */
	parentListContext?: ListContext;
	parent: {
		blockEdit: BlockEditActions;
		focus: FocusActions;
		containerEdit: ContainerEditActions;
	};
}

/**
 * Receives stable default bundle references and returns per-sub-interface
 * partial overrides. Chain via `defaults.blockEdit.foo(...)`.
 */
export type NestedActionsOverrideFactory = (defaults: NestedActionsBundle) => {
	blockEdit?: Partial<BlockEditActions>;
	focus?: Partial<FocusActions>;
	containerEdit?: Partial<ContainerEditActions>;
};

export function createStandardNestedActions(
	state: BlockListState,
	deps: NestedActionsDeps,
	overrideFactory?: NestedActionsOverrideFactory
): NestedActionsBundle {
	// `index`, `node`, and `path` are intentionally not destructured:
	// containers expose them as getters (`get index()`, `get node()`) so
	// closures read live reactive values. Destructuring would capture stale
	// snapshots after a parent structural op or undo/redo replacement.
	const blockEdit = createNestedBlockEdit(state, deps);
	const focus = createNestedFocus(state, deps);
	// Commit coordinates are doc-absolute at their mint point (block-edit-scope
	// factories / context callers), so intermediate containers have nothing to
	// remap — the parent's containerEdit passes through every level unchanged.
	const containerEdit = deps.parent.containerEdit;

	const defaults: NestedActionsBundle = { blockEdit, focus, containerEdit };
	if (!overrideFactory) return defaults;

	const overrides = overrideFactory(defaults);
	return {
		blockEdit: { ...blockEdit, ...(overrides.blockEdit ?? {}) },
		focus: { ...focus, ...(overrides.focus ?? {}) },
		containerEdit: { ...containerEdit, ...(overrides.containerEdit ?? {}) }
	};
}

/** Set the three container sub-interface contexts in one call. */
export function setNestedActionsContexts(bundle: NestedActionsBundle): void {
	const keys = [BLOCK_EDIT_KEY, FOCUS_KEY, CONTAINER_EDIT_KEY];
	assertInvariant('container-history-key', () => checkNoContainerHistoryKey(keys, HISTORY_KEY));
	setContext(BLOCK_EDIT_KEY, bundle.blockEdit);
	setContext(FOCUS_KEY, bundle.focus);
	setContext(CONTAINER_EDIT_KEY, bundle.containerEdit);
}
