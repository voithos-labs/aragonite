/**
 * The container-authoring seam a plugin block component builds on. Collapses the
 * built-in container wiring — block-list state, nested actions + the five ancestor
 * contexts, container-exit override, nested windowing, and the `BlockComponent`
 * shim — into one factory, so a plugin never touches an editor context key or the
 * internal helpers. Mirrors `BlockquoteBlock`'s wiring exactly; the plugin supplies
 * only its own chrome around the returned `BlockList` props.
 *
 * Call synchronously during component init — `getContext` reads the ancestor
 * contexts and `useContainerWindowing` sets its own.
 */

import { getContext } from 'svelte';
import type { ComponentProps } from 'svelte';
import type BlockList from '../components/BlockList.svelte';
import type { BlockEditActions, ContainerEditActions, FocusActions } from '../action-contracts';
import type { BlockComponent } from '../block-component';
import type { CstNode } from '../core/nodes';
import type { StickyColumnState } from '../cursor/sticky-column';
import {
	BLOCK_EDIT_KEY,
	CONTAINER_EDIT_KEY,
	CONTROLLER_KEY,
	FOCUS_KEY,
	STICKY_COLUMN_KEY
} from '../editor-keys';
import { createBlockListState } from '../reactivity/block-list-state.svelte';
import { useContainerWindowing } from '../reactivity/use-container-windowing.svelte';
import { createBlockquoteOverrides } from './blockquote-overrides';
import { createContainerBlockComponent } from './container-block-component';
import type { UndoController } from './deps';
import {
	createStandardNestedActions,
	setNestedActionsContexts,
	type NestedActionsOverrideFactory
} from './nested/nested-actions';

/**
 * Reactive inputs the host component feeds in as getters (Design Rule 5): each is
 * re-read live so a parent structural op or undo replacement is observed, never
 * snapshotted. `getBoxEl` returns the component's chrome box — the element whose
 * sole `.block-list` child the windowing lookups walk.
 */
export interface ContainerBlockDeps {
	get node(): CstNode;
	get index(): number;
	get path(): number[];
	getBoxEl(): HTMLElement | undefined;
	/** Collapse clamp — while true only the chrome row (child 0) mounts; body children
	 *  genuinely unmount. Read live (typically off this node's metadata) so a toggle or
	 *  its undo re-renders reactively. */
	isCollapsed?: () => boolean;
}

/** The `BlockList` props the host spreads onto its rendered `<BlockList>`. */
export type ContainerBlockListProps = Pick<
	ComponentProps<typeof BlockList>,
	'children' | 'blockIds' | 'setRef' | 'getRef' | 'parentPath' | 'window' | 'reorderable'
>;

export interface ContainerBlock {
	/** Spread onto `<BlockList {...blockListProps} />` inside the chrome box. */
	blockListProps: ContainerBlockListProps;
	/** The `BlockComponent` surface the host re-exports for BlockHost. */
	containerApi: BlockComponent;
	/**
	 * Commit a shallow metadata patch on THIS container node as one undoable
	 * entry, round-tripping through the kind's `rebuildRaw`. `afterTick` runs
	 * once the commit's DOM has settled — a collapse toggle moves the orphaned
	 * body caret to the chrome row here (the clamp kills the window pin).
	 */
	updateOwnMetadata(patch: Record<string, unknown>, afterTick?: () => void): void | Promise<void>;
}

/**
 * M3 collapse gate for a chrome leaf's Enter → `descendToBody`. While the
 * container is collapsed its body children are unmounted, so descending would
 * mint an invisible body paragraph (the existing-body branch already no-ops on
 * the unmounted ref). Consume the key and change nothing; delegate otherwise.
 */
export function gateDescendOnCollapse(
	isCollapsed: (() => boolean) | undefined,
	descend: (innerIndex: number) => void | Promise<void>
): (innerIndex: number) => Promise<void> {
	return async (innerIndex) => {
		if (isCollapsed?.()) return;
		await descend(innerIndex);
	};
}

export function createContainerBlock(deps: ContainerBlockDeps): ContainerBlock {
	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const controller = getContext<UndoController>(CONTROLLER_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);

	const listState = createBlockListState(() => deps.node);

	const blockquoteOverrides = createBlockquoteOverrides({
		get index() {
			return deps.index;
		},
		get node() {
			return deps.node;
		},
		get path() {
			return deps.path;
		},
		state: listState,
		parentBlockEdit,
		parentFocus,
		controller
	});

	// Compose the M3 collapse gate onto the blockquote exit override: a collapsed
	// container's chrome Enter must not mint an invisible body (§4). Both override
	// the same `defaults`, so the blockquote's `splitBlock` and the gate's
	// `descendToBody` coexist. For a non-collapsing container the gate is inert.
	const overrideFactory: NestedActionsOverrideFactory = (defaults) => {
		const base = blockquoteOverrides(defaults);
		return {
			...base,
			blockEdit: {
				...base.blockEdit,
				descendToBody: gateDescendOnCollapse(deps.isCollapsed, defaults.blockEdit.descendToBody)
			}
		};
	};

	const bundle = createStandardNestedActions(
		listState,
		{
			get index() {
				return deps.index;
			},
			get node() {
				return deps.node;
			},
			get path() {
				return deps.path;
			},
			stickyColumn,
			parent: {
				blockEdit: parentBlockEdit,
				focus: parentFocus,
				containerEdit: parentContainerEdit
			}
		},
		overrideFactory
	);

	setNestedActionsContexts(bundle);

	const windowing = useContainerWindowing({
		getIndex: () => deps.index,
		getParentPath: () => deps.path,
		getChildren: () => deps.node.children ?? [],
		getChildIds: () => listState.innerBlockIds,
		getListEl: () => deps.getBoxEl()?.querySelector(':scope > .block-list') ?? null,
		getOwnEl: () => deps.getBoxEl()?.closest('.block-host') ?? null,
		provideLeafChannel: true,
		isCollapsed: deps.isCollapsed
	});

	const containerApi = createContainerBlockComponent({
		get innerBlockRefs() {
			return listState.innerBlockRefs;
		},
		get nodeChildrenLength() {
			return deps.node.children?.length ?? 0;
		},
		get node() {
			return deps.node;
		},
		revealChild: windowing.revealChild,
		isInWindow: windowing.isInWindow,
		isCollapsed: deps.isCollapsed
	});

	const blockListProps: ContainerBlockListProps = {
		get children() {
			return deps.node.children ?? [];
		},
		get blockIds() {
			return listState.innerBlockIds;
		},
		setRef: (i, r) => (listState.innerBlockRefs[i] = r),
		getRef: (i) => listState.innerBlockRefs[i],
		get parentPath() {
			return deps.path;
		},
		get window() {
			return windowing.window;
		},
		reorderable: true
	};

	return {
		blockListProps,
		containerApi,
		updateOwnMetadata: (patch, afterTick) =>
			parentBlockEdit.updateBlockMetadata(deps.index, patch, { afterTick })
	};
}
