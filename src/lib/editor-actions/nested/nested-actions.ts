/**
 * Composer for container nestedActions bundles. HistoryActions is deliberately
 * absent: containers never override history, and Svelte context delivers the
 * document-level HISTORY_KEY to any descendant.
 */

import { setContext } from 'svelte';
import type {
	BlockEditActions,
	ContainerEditActions,
	FocusActions,
	ListContext
} from '../../action-contracts';
import type { NodeView } from '../../core/node-views';
import type { GrammarView } from '../../schema/block-openers';
import {
	BLOCK_EDIT_KEY,
	CONTAINER_EDIT_KEY,
	FOCUS_KEY,
	HISTORY_KEY,
	type PresentationModeGetter
} from '../../editor-keys';
import { assertInvariant } from '../../invariants/assert';
import { checkNoContainerHistoryKey } from '../../invariants/context-keys';
import type { StickyColumnState } from '../../cursor/sticky-column';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import { createNestedBlockEdit } from './nested-block-edit';
import { createNestedFocus } from './nested-focus';
import type { InlineResolverRef } from '../../schema/inline-construct-policy';

export interface NestedActionsBundle {
	blockEdit: BlockEditActions;
	focus: FocusActions;
	containerEdit: ContainerEditActions;
}

/**
 * The three container coordinates every nested factory reads live. A component mints
 * ONE of these and passes it BY REFERENCE to each factory it wires — never spread,
 * which invokes the getters and captures stale values.
 */
export interface NodeScope {
	get index(): number;
	get node(): NodeView;
	/** Doc-absolute path of `node`; spine unsharing + ancestry rebuilds key off it. */
	get path(): number[];
}

export interface NestedActionsDeps {
	index: number;
	node: NodeView;
	/** Doc-absolute path of `node`; spine unsharing + ancestry rebuilds key off it. */
	path: number[];
	stickyColumn: StickyColumnState;
	/** The instance's block grammar, so a disabled kind's opener stays skipped when a
	 *  nested block re-parses. Absent = the global grammar. */
	grammar?: GrammarView;
	/** Live EFFECTIVE mode, for interior mutations whose bytes depend on what the mode paints
	 *  (the split rebalance). Nullable rather than optional so each container answers. */
	getPresentationMode: PresentationModeGetter | undefined;
	/** The instance's link-reference resolver, required-nullable beside the mode. */
	linkRef: InlineResolverRef | undefined;
	/** Enclosing list's context, when this container is a list nested in one. */
	parentListContext?: ListContext;
	parent: {
		blockEdit: BlockEditActions;
		focus: FocusActions;
		containerEdit: ContainerEditActions;
	};
}

/**
 * `createStandardNestedActions`'s public input: the shared `NodeScope` by reference
 * plus the static config `NestedActionsDeps` carries.
 */
export type NestedActionsInput = Omit<NestedActionsDeps, 'index' | 'node' | 'path'> & {
	scope: NodeScope;
};

/** Receives stable default bundle references; chain via `defaults.blockEdit.foo(...)`. */
export type NestedActionsOverrideFactory = (defaults: NestedActionsBundle) => {
	blockEdit?: Partial<BlockEditActions>;
	focus?: Partial<FocusActions>;
	containerEdit?: Partial<ContainerEditActions>;
};

export function createStandardNestedActions(
	state: BlockListState,
	input: NestedActionsInput,
	overrideFactory?: NestedActionsOverrideFactory
): NestedActionsBundle {
	// Adapt `scope` to the inline shape the sub-factories read, once at the choke point
	// rather than at every call site. Getters stay live; destructuring would snapshot.
	const deps: NestedActionsDeps = {
		get index() {
			return input.scope.index;
		},
		get node() {
			return input.scope.node;
		},
		get path() {
			return input.scope.path;
		},
		stickyColumn: input.stickyColumn,
		grammar: input.grammar,
		getPresentationMode: input.getPresentationMode,
		linkRef: input.linkRef,
		parentListContext: input.parentListContext,
		parent: input.parent
	};
	const blockEdit = createNestedBlockEdit(state, deps);
	const focus = createNestedFocus(state, deps);
	// Commit coordinates are doc-absolute at their mint point (block-edit-scope), so
	// intermediate containers have nothing to remap and this passes straight through.
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

export function setNestedActionsContexts(bundle: NestedActionsBundle): void {
	const keys = [BLOCK_EDIT_KEY, FOCUS_KEY, CONTAINER_EDIT_KEY];
	assertInvariant('container-history-key', () => checkNoContainerHistoryKey(keys, HISTORY_KEY));
	setContext(BLOCK_EDIT_KEY, bundle.blockEdit);
	setContext(FOCUS_KEY, bundle.focus);
	setContext(CONTAINER_EDIT_KEY, bundle.containerEdit);
}
