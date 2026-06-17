<script lang="ts">
	import { getContext, setContext } from 'svelte';
	import type {
		BlockEditActions,
		ContainerEditActions,
		FocusActions
	} from '../../action-contracts';
	import type { CstNode } from '../../core/nodes';
	import {
		BLOCK_EDIT_KEY,
		CONTAINER_EDIT_KEY,
		CONTROLLER_KEY,
		EDITOR_ROOT_KEY,
		FOCUSED_PATH_KEY,
		FOCUS_KEY,
		HEIGHT_ORACLE_KEY,
		PARENT_SCOPE_SINK_KEY,
		RECORD_BLOCK_HEIGHT_KEY,
		STICKY_COLUMN_KEY,
		type FocusedPathGetter,
		type ParentScopeSink,
		type RecordBlockHeight
	} from '../../editor-keys';
	import type { UndoController } from '../../editor-actions/deps';
	import type { StickyColumnState } from '../../cursor/sticky-column';
	import type { HeightOracle } from '../../cursor/height-oracle';
	import { createBlockquoteOverrides } from '../../editor-actions/blockquote-overrides';
	import { createBlockListState } from '../../reactivity/block-list-state.svelte';
	import { createListWindowing } from '../../reactivity/list-windowing.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from '../../editor-actions/nested-actions';
	import { createContainerBlockComponent } from '../../editor-actions/container-block-component';
	import BlockList from '../BlockList.svelte';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const controller = getContext<UndoController>(CONTROLLER_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);

	// VR contexts read BEFORE the shadowing setContexts below, so they resolve to
	// the parent scope's values, not this scope's. parentSink receives this
	// blockquote's own box subtotal; the oracle/root/focus drive its child window.
	const heightOracle = getContext<HeightOracle>(HEIGHT_ORACLE_KEY);
	const getEditorRoot = getContext<() => HTMLElement | null>(EDITOR_ROOT_KEY);
	const getFocusPath = getContext<FocusedPathGetter>(FOCUSED_PATH_KEY);
	const parentSink = getContext<ParentScopeSink | undefined>(PARENT_SCOPE_SINK_KEY);

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

	const windowing = createListWindowing({
		oracle: heightOracle,
		getChildren: () => node.children ?? [],
		getChildIds: () => listState.innerBlockIds,
		getListEl: () => boxEl?.querySelector(':scope > .block-list') ?? null,
		// The element the parent measures for this blockquote's height. Reporting the
		// same box up keeps the subtotal channel byte-identical to the leaf channel —
		// no two-writer fight on the parent's slot.
		getOwnEl: () => boxEl?.closest('.block-host') ?? null,
		getScrollEl: () => getEditorRoot?.() ?? null,
		getFocusPath: () => getFocusPath?.() ?? null,
		getParentPath: () => myPath,
		reportSelfHeight: (h) => parentSink?.setChildSubtotal(index, h),
		overscan: 4,
		pinExtensionCap: 100,
		activateAbovePx: 4000,
		deactivateBelowPx: 3000
	});

	// Leaf channel: a DIRECT child (path one deeper than mine) measures into MY model.
	setContext(RECORD_BLOCK_HEIGHT_KEY, ((path, id, h) => {
		if (path.length === myPath.length + 1)
			windowing.recordMeasuredChild(path[myPath.length], id, h);
	}) satisfies RecordBlockHeight);
	// Subtotal channel: MY direct child containers report their box subtotal up by index.
	setContext(PARENT_SCOPE_SINK_KEY, {
		setChildSubtotal: windowing.setChildSubtotal
	} satisfies ParentScopeSink);

	// ── BlockComponent interface ────────────────────────────────────────

	const containerApi = createContainerBlockComponent({
		get innerBlockRefs() {
			return listState.innerBlockRefs;
		},
		get nodeChildrenLength() {
			return node.children?.length ?? 0;
		}
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
</script>

<div class="blockquote-block" bind:this={boxEl}>
	<BlockList
		children={node.children ?? []}
		blockIds={listState.innerBlockIds}
		setRef={(i, r) => (listState.innerBlockRefs[i] = r)}
		getRef={(i) => listState.innerBlockRefs[i]}
		parentPath={myPath}
		window={windowing.window}
	/>
</div>

<style>
	.blockquote-block {
		border-left: 3px solid var(--color-ui-muted, #a4a4a4);
		padding-left: 16px;
		margin: 4px 0;
	}
</style>
