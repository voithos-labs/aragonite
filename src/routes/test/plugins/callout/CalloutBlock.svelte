<script lang="ts">
	// SPIKE (WS-B Cycle 1, Task 2): a plugin container component built by mirroring
	// the built-in BlockquoteBlock and reaching straight into `$lib` internals. The
	// point is discovery — every deep import below is a piece the future thin
	// container-authoring surface must hide (see the task report). Only the chrome
	// (a bordered/iconed box instead of blockquote's `> ` left bar) differs from the
	// model; the editability wiring is copied verbatim so split/merge/undo behave.
	import { getContext } from 'svelte';
	import type { BlockEditActions, ContainerEditActions, FocusActions } from '$lib/action-contracts';
	import type { CstNode } from '$lib/core/nodes';
	import {
		BLOCK_EDIT_KEY,
		CONTAINER_EDIT_KEY,
		CONTROLLER_KEY,
		FOCUS_KEY,
		STICKY_COLUMN_KEY
	} from '$lib/editor-keys';
	import type { UndoController } from '$lib/editor-actions/deps';
	import type { StickyColumnState } from '$lib/cursor/sticky-column';
	import { createBlockquoteOverrides } from '$lib/editor-actions/blockquote-overrides';
	import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
	import { useContainerWindowing } from '$lib/reactivity/use-container-windowing.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from '$lib/editor-actions/nested/nested-actions';
	import { createContainerBlockComponent } from '$lib/editor-actions/container-block-component';
	import BlockList from '$lib/components/BlockList.svelte';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const controller = getContext<UndoController>(CONTROLLER_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);

	const listState = createBlockListState(() => node);

	let boxEl: HTMLElement | undefined = $state();

	const bundle = createStandardNestedActions(
		listState,
		{
			get index() {
				return index;
			},
			get node() {
				return node;
			},
			get path() {
				return myPath;
			},
			stickyColumn,
			parent: {
				blockEdit: parentBlockEdit,
				focus: parentFocus,
				containerEdit: parentContainerEdit
			}
		},
		// Reused as-is from the built-in blockquote: the Enter-on-empty-trailing-child
		// container exit. Its blockquote-specific NAME is a finding — the container-exit
		// logic is generic, so the thin surface should generalize it rather than force a
		// plugin to import a `blockquote-*` module.
		createBlockquoteOverrides({
			get index() {
				return index;
			},
			get node() {
				return node;
			},
			get path() {
				return myPath;
			},
			state: listState,
			parentBlockEdit,
			parentFocus,
			controller
		})
	);

	setNestedActionsContexts(bundle);

	// ── Virtual rendering (nested windowing) ────────────────────────────

	const windowing = useContainerWindowing({
		getIndex: () => index,
		getParentPath: () => myPath,
		getChildren: () => node.children ?? [],
		getChildIds: () => listState.innerBlockIds,
		getListEl: () => boxEl?.querySelector(':scope > .block-list') ?? null,
		getOwnEl: () => boxEl?.closest('.block-host') ?? null,
		provideLeafChannel: true
	});

	// ── BlockComponent interface ────────────────────────────────────────

	const containerApi = createContainerBlockComponent({
		get innerBlockRefs() {
			return listState.innerBlockRefs;
		},
		get nodeChildrenLength() {
			return node.children?.length ?? 0;
		},
		get node() {
			return node;
		},
		revealChild: windowing.revealChild,
		isInWindow: windowing.isInWindow
	});
	export const editable = containerApi.editable;
	export const focusable = containerApi.focusable;
	export const focus = containerApi.focus;
	export const getCursorOffset = containerApi.getCursorOffset;
	export const getCursorPosition = containerApi.getCursorPosition;
	export const focusByPath = containerApi.focusByPath;
	export const focusAtColumn = containerApi.focusAtColumn;
	export const isVerticallyTransparent = containerApi.isVerticallyTransparent!;
	export const selectEdgeWidget = containerApi.selectEdgeWidget!;
	export const getBlockComponentByPath = containerApi.getBlockComponentByPath!;
	export const revealByPath = containerApi.revealByPath!;
</script>

<div class="callout-block" bind:this={boxEl}>
	<BlockList
		children={node.children ?? []}
		blockIds={listState.innerBlockIds}
		setRef={(i, r) => (listState.innerBlockRefs[i] = r)}
		getRef={(i) => listState.innerBlockRefs[i]}
		parentPath={myPath}
		window={windowing.window}
		reorderable={true}
	/>
</div>

<style>
	/* Chrome is the only intended divergence from BlockquoteBlock. The icon is a
	   positioned pseudo-element so BlockList stays the box's sole child element —
	   the windowing `:scope > .block-list` lookup depends on that adjacency. */
	.callout-block {
		position: relative;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 6px;
		background: color-mix(in srgb, var(--color-ui-muted, #a4a4a4) 8%, transparent);
		padding: 8px 12px 8px 34px;
		margin: 6px 0;
	}
	.callout-block::before {
		content: 'ℹ';
		position: absolute;
		left: 10px;
		top: 8px;
		font-size: 14px;
		line-height: 1.4;
		color: var(--color-text-secondary, #888);
	}
</style>
