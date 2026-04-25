/**
 * Composer for container nestedActions bundles — produces a complete
 * { blockEdit, focus, containerEdit } triple from a state bundle and the
 * container's raw rebuild. HistoryActions is deliberately absent: containers
 * never override history; Svelte context delivers the document-level
 * HISTORY_KEY to any descendant.
 */

import { setContext } from 'svelte';
import type { BlockEditActions, FocusActions, ContainerEditActions, CstNode } from '../contracts';
import { BLOCK_EDIT_KEY, FOCUS_KEY, CONTAINER_EDIT_KEY } from '../contracts';
import type { StickyColumnState } from '../cursor/sticky-column';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import { createNestedBlockEdit } from './nested-block-edit';
import { createNestedFocus } from './nested-focus';
import { createNestedContainerEdit } from './nested-container-edit';

export interface NestedActionsBundle {
	blockEdit: BlockEditActions;
	focus: FocusActions;
	containerEdit: ContainerEditActions;
}

export interface NestedActionsDeps {
	index: number;
	node: CstNode;
	rebuildRaw: () => void;
	stickyColumn: StickyColumnState;
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
	// `index` and `node` are intentionally not destructured: containers expose
	// both as getters (`get index()`, `get node()`) so closures read live
	// reactive values. Destructuring would capture stale snapshots after a
	// parent structural op or undo/redo replacement.
	const blockEdit = createNestedBlockEdit(state, deps);
	const focus = createNestedFocus(state, deps);
	const containerEdit = createNestedContainerEdit(deps);

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
	setContext(BLOCK_EDIT_KEY, bundle.blockEdit);
	setContext(FOCUS_KEY, bundle.focus);
	setContext(CONTAINER_EDIT_KEY, bundle.containerEdit);
}
