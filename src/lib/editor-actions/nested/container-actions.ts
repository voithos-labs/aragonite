/**
 * The action bundle a container block hands its children, built the same way for every container
 * kind: its parent's actions and the editor's reading in, the children's actions provided out.
 * Call it once during component init. It reads the action contexts before it sets them, so a
 * caller that needs a parent context (a list's own list context) reads it before the call.
 */

import { getContext } from 'svelte';
import type {
	BlockEditActions,
	ContainerEditActions,
	FocusActions,
	ListContext
} from '../../action-contracts';
import type { NodeView } from '../../core/node-views';
import {
	BLOCK_EDIT_KEY,
	CONTAINER_EDIT_KEY,
	EDITOR_DOC_KEY,
	EDITOR_SERVICES_KEY,
	FOCUS_KEY,
	type EditorDoc,
	type EditorServices
} from '../../editor-keys';
import {
	createBlockListState,
	type BlockListState
} from '../../reactivity/block-list-state.svelte';
import type { Reading } from '../../schema/reading';
import {
	createStandardNestedActions,
	setNestedActionsContexts,
	type NestedActionsBundle,
	type NestedActionsDeps,
	type NestedActionsOverrideFactory,
	type NodeScope
} from './nested-actions';

export interface ContainerActionsDeps {
	getNode: () => NodeView;
	getIndex: () => number;
	getPath: () => number[];
	/** The container's own rules over the default child actions, given its scope and its parent. */
	overrides?: (parts: {
		scope: NodeScope;
		parent: NestedActionsDeps['parent'];
	}) => NestedActionsOverrideFactory;
	/** The enclosing list's context, for a list nested in one. */
	parentListContext?: ListContext;
}

export interface ContainerActions {
	/** The container's live index, node and path, shared by reference with every factory. */
	scope: NodeScope;
	state: BlockListState;
	bundle: NestedActionsBundle;
	parent: NestedActionsDeps['parent'];
	reading: Reading;
}

export function createContainerActions(deps: ContainerActionsDeps): ContainerActions {
	const parent: NestedActionsDeps['parent'] = {
		blockEdit: getContext<BlockEditActions>(BLOCK_EDIT_KEY),
		focus: getContext<FocusActions>(FOCUS_KEY),
		containerEdit: getContext<ContainerEditActions>(CONTAINER_EDIT_KEY)
	};
	const { stickyColumn } = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const { reading } = getContext<EditorDoc>(EDITOR_DOC_KEY);

	const state = createBlockListState(deps.getNode);
	// Getters, never a spread: a spread would snapshot the container's position.
	const scope: NodeScope = {
		get index() {
			return deps.getIndex();
		},
		get node() {
			return deps.getNode();
		},
		get path() {
			return deps.getPath();
		}
	};

	const bundle = createStandardNestedActions(
		state,
		{ scope, stickyColumn, reading, parentListContext: deps.parentListContext, parent },
		deps.overrides?.({ scope, parent })
	);
	setNestedActionsContexts(bundle);
	return { scope, state, bundle, parent, reading };
}
