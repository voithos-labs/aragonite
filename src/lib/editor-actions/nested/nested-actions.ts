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
import type { GrammarView } from '../../schema/block-openers';
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

/**
 * The three container coordinates every nested factory reads live. A component
 * mints ONE of these and passes it BY REFERENCE to each factory it wires — never
 * spread (`{ ...scope }` invokes the getters and captures stale values, the
 * value-capture incident class).
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
	/** The instance's block grammar, threaded to this
	 *  container's content-commit reparse so a disabled kind's opener stays skipped when a
	 *  nested block re-parses — parity with the top-level factory. Absent = the global grammar. */
	grammar?: GrammarView;
	/** Enclosing list's context, when this container is a list nested in one. */
	parentListContext?: ListContext;
	parent: {
		blockEdit: BlockEditActions;
		focus: FocusActions;
		containerEdit: ContainerEditActions;
	};
}

/**
 * `createStandardNestedActions`'s public input: the shared `NodeScope` by
 * reference plus the same static config `NestedActionsDeps` carries. Adapted
 * internally to the inline-scope `NestedActionsDeps` the sub-factories read, so
 * their contract (and the sibling factories importing it) stays untouched.
 */
export type NestedActionsInput = Omit<NestedActionsDeps, 'index' | 'node' | 'path'> & {
	scope: NodeScope;
};

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
	input: NestedActionsInput,
	overrideFactory?: NestedActionsOverrideFactory
): NestedActionsBundle {
	// Adapt the shared `scope` to the inline-scope shape the sub-factories read.
	// The trio is re-spelled once here, at the choke point, instead of at every
	// container call site; the getters stay live (each read walks back to the
	// component's own scope getters), and destructuring `scope` would snapshot.
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
		parentListContext: input.parentListContext,
		parent: input.parent
	};
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
