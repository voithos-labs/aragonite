/**
 * Builds a container's action bundle. HistoryActions is left out on purpose: containers
 * never override history, and Svelte context delivers the document-level HISTORY_KEY to
 * every descendant.
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
import { assertInvariant } from '../../assert';
import { checkNoContainerHistoryKey } from '../../invariants/context-keys';
import type { StickyColumnState } from '../../cursor/sticky-column';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import { createNestedBlockEdit } from './nested-block-edit';
import { createNestedFocus } from './nested-focus';
import { withEnterCompletion } from '../enter-completion';
import type { Reading } from '../../schema/reading';

export interface NestedActionsBundle {
	blockEdit: BlockEditActions;
	focus: FocusActions;
	containerEdit: ContainerEditActions;
}

/**
 * The three container coordinates every nested factory reads live. A component creates one
 * of these and passes it by reference to each factory it wires, never spread: spreading
 * calls the getters and captures stale values.
 */
export interface NodeScope {
	get index(): number;
	get node(): NodeView;
	/** Document-absolute path of `node`; the copy-before-write and the ancestor rebuild use it. */
	get path(): number[];
}

export interface NestedActionsDeps {
	index: number;
	node: NodeView;
	/** Document-absolute path of `node`; the copy-before-write and the ancestor rebuild use it. */
	path: number[];
	stickyColumn: StickyColumnState;
	/** The editor's reading, so a nested re-parse or completer reads only the syntax the editor
	 *  switched on and a split's rebalance knows what its mode shows. */
	reading: Reading;
	/** The enclosing list's context, when this container is a list nested in one. */
	parentListContext?: ListContext;
	parent: {
		blockEdit: BlockEditActions;
		focus: FocusActions;
		containerEdit: ContainerEditActions;
	};
}

/**
 * `createStandardNestedActions`'s input: the shared `NodeScope` by reference plus the static
 * configuration `NestedActionsDeps` carries.
 */
export type NestedActionsInput = Omit<NestedActionsDeps, 'index' | 'node' | 'path'> & {
	scope: NodeScope;
};

/** Receives the stable default bundle; chain through `defaults.blockEdit.foo(...)`. */
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
	// Adapt `scope` to the shape the sub-factories read, once here rather than at every call
	// site. Getters stay live; destructuring would snapshot.
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
		reading: input.reading,
		parentListContext: input.parentListContext,
		parent: input.parent
	};
	const blockEdit = createNestedBlockEdit(state, deps);
	const focus = createNestedFocus(state, deps);
	// Commit paths are document-absolute where they are made (block-edit-scope), so
	// intermediate containers have nothing to remap and this passes straight through.
	const containerEdit = deps.parent.containerEdit;

	const defaults: NestedActionsBundle = { blockEdit, focus, containerEdit };
	// Above the override spread, so a container replacing `splitBlock` keeps the Enter
	// completion its subtree needs. `defaults` stays unwrapped: an override chaining back into
	// it is already past the check, and checking again would spend one Enter on two.
	const childAt = (index: number) => deps.node.children?.[index];
	if (!overrideFactory) {
		return {
			...defaults,
			blockEdit: withEnterCompletion(blockEdit, childAt, deps.reading.grammar)
		};
	}

	const overrides = overrideFactory(defaults);
	return {
		blockEdit: withEnterCompletion(
			{ ...blockEdit, ...(overrides.blockEdit ?? {}) },
			childAt,
			deps.reading.grammar
		),
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
