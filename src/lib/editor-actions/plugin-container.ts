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
import type {
	BlockEditActions,
	ContainerEditActions,
	FocusActions,
	MoveFocusOptions
} from '../action-contracts';
import type { BlockComponent } from '../block-component';
import type { CstNode } from '../core/nodes';
import type { StickyColumnState } from '../cursor/sticky-column';
import { isCollapsedContainer } from '../schema/reserved-chrome';
import { devWarn } from '../dev-warn';
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
 * direct `.block-list` child the windowing lookups walk (`:scope > .block-list`,
 * so chrome siblings beside the list are fine; it need not be the sole child).
 */
export interface ContainerBlockDeps {
	get node(): CstNode;
	get index(): number;
	get path(): number[];
	getBoxEl(): HTMLElement | undefined;
	/**
	 * Collapse clamp — while true only the chrome row (child 0) mounts; body
	 * children genuinely unmount. Optional: a container that declares
	 * `reservedChrome.isCollapsed` needs no dep — the factory derives the clamp
	 * from that one probe. Supply it only as an escape hatch (dev-warns when it
	 * disagrees with the declared probe). Read live so a toggle or its undo
	 * re-renders reactively.
	 */
	isCollapsed?: () => boolean;
}

/** The `BlockList` props the host spreads onto its rendered `<BlockList>`. */
export type ContainerBlockListProps = Pick<
	ComponentProps<typeof BlockList>,
	'children' | 'blockIds' | 'setRef' | 'getRef' | 'parentPath' | 'window' | 'reorderable'
>;

/**
 * The `BlockComponent` surface `createContainerBlock` returns, with the members
 * the container shim always supplies promoted to required — so a host re-exports
 * them for BlockHost without a per-member non-null assertion.
 */
export type ContainerBlockComponent = BlockComponent &
	Required<
		Pick<
			BlockComponent,
			| 'getCursorPosition'
			| 'focusByPath'
			| 'getBlockComponentByPath'
			| 'revealByPath'
			| 'focusAtColumn'
			| 'isVerticallyTransparent'
			| 'selectEdgeWidget'
		>
	>;

/**
 * The shim returns the weaker `BlockComponent` (container members optional), so a
 * host can only re-export them as required by narrowing through this check — not a
 * blind cast. Members mirror the `Required<Pick<…>>` above; a future drop by the
 * shim throws at the seam here instead of surfacing as an `undefined` re-export.
 */
function suppliesContainerMembers(c: BlockComponent): c is ContainerBlockComponent {
	return (
		c.getCursorPosition !== undefined &&
		c.focusByPath !== undefined &&
		c.getBlockComponentByPath !== undefined &&
		c.revealByPath !== undefined &&
		c.focusAtColumn !== undefined &&
		c.isVerticallyTransparent !== undefined &&
		c.selectEdgeWidget !== undefined
	);
}

export interface ContainerBlock {
	/** Spread onto `<BlockList {...blockListProps} />` inside the chrome box. */
	blockListProps: ContainerBlockListProps;
	/** The `BlockComponent` surface the host re-exports for BlockHost. */
	containerApi: ContainerBlockComponent;
	/**
	 * Commit a shallow metadata patch on THIS container node as one undoable
	 * entry, round-tripping through the kind's `rebuildRaw`. `afterTick` runs
	 * once the commit's DOM has settled — a collapse toggle moves the orphaned
	 * body caret to the chrome row here (the clamp kills the window pin).
	 */
	updateOwnMetadata(patch: Record<string, unknown>, afterTick?: () => void): void | Promise<void>;
}

/**
 * Collapse-ness has ONE definition: the descriptor's `reservedChrome.isCollapsed`
 * probe. The window/focus clamp derives from it, so a container that declares the
 * probe needn't also thread a dep. An explicit dep stays an escape hatch; in dev
 * it's cross-checked against the probe so a half-collapsed hybrid (model says
 * collapsed, view stays open, or vice versa) is loud, not silent.
 */
export function composeCollapseProbe(
	explicit: (() => boolean) | undefined,
	getNode: () => CstNode
): () => boolean {
	if (!explicit) return () => isCollapsedContainer(getNode());
	return () => {
		const value = explicit();
		if (import.meta.env.DEV && value !== isCollapsedContainer(getNode())) {
			devWarn(
				'plugin-container',
				`isCollapsed dep disagrees with the declared reservedChrome.isCollapsed probe for kind "${getNode().kind}"`
			);
		}
		return value;
	};
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

/**
 * I-1 collapse gate for the interior `moveFocus`. While collapsed only the
 * chrome row (child 0) is mounted, so a move targeting a body index dead-ends
 * on the unmounted ref inside `dispatchMoveFocus` (its in-range branch finds no
 * focusable block and returns). Route body targets past the container instead —
 * the same exit an open container's past-end move takes. Upward moves and the
 * chrome row itself keep the inner dispatch.
 */
export function gateMoveFocusOnCollapse(
	isCollapsed: (() => boolean) | undefined,
	moveWithin: FocusActions['moveFocus'],
	parentFocus: FocusActions,
	getIndex: () => number
): FocusActions['moveFocus'] {
	return async (innerIndex, position, options?: MoveFocusOptions) => {
		if (innerIndex >= 1 && isCollapsed?.()) {
			// Omit the options arg when unset so the common path stays a two-arg
			// call, mirroring dispatchMoveFocus's own upward delegation.
			if (options) await parentFocus.moveFocus(getIndex() + 1, position, options);
			else await parentFocus.moveFocus(getIndex() + 1, position);
			return;
		}
		await moveWithin(innerIndex, position, options);
	};
}

export function createContainerBlock(deps: ContainerBlockDeps): ContainerBlock {
	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const controller = getContext<UndoController>(CONTROLLER_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);

	const listState = createBlockListState(() => deps.node);

	const collapsed = composeCollapseProbe(deps.isCollapsed, () => deps.node);

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

	// Compose the collapse gates onto the blockquote exit override: a collapsed
	// container's chrome Enter must not mint an invisible body (M3, §4), and its
	// chrome ArrowDown/ArrowRight must exit past the unmounted body (I-1). All
	// override the same `defaults`, so the blockquote's `splitBlock` and the two
	// gates coexist. For a non-collapsing container the gates are inert.
	const overrideFactory: NestedActionsOverrideFactory = (defaults) => {
		const base = blockquoteOverrides(defaults);
		return {
			...base,
			blockEdit: {
				...base.blockEdit,
				descendToBody: gateDescendOnCollapse(collapsed, defaults.blockEdit.descendToBody)
			},
			focus: {
				moveFocus: gateMoveFocusOnCollapse(
					collapsed,
					defaults.focus.moveFocus,
					parentFocus,
					() => deps.index
				)
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
		isCollapsed: collapsed
	});

	const base = createContainerBlockComponent({
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
		isCollapsed: collapsed
	});
	if (!suppliesContainerMembers(base)) {
		throw new Error('createContainerBlockComponent must supply every container method');
	}
	const containerApi: ContainerBlockComponent = base;

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
