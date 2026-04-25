<script lang="ts">
	import { getContext } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		FOCUS_KEY,
		CONTAINER_EDIT_KEY,
		CONTROLLER_KEY,
		STICKY_COLUMN_KEY,
		CURSOR_END,
		type BlockEditActions,
		type FocusActions,
		type ContainerEditActions,
		type StickyColumnDirection,
		type CstNode,
		type BlockComponent
	} from '../../contracts';
	import type { UndoController } from '../../editor-actions/deps';
	import type { StickyColumnState } from '../../cursor/sticky-column';
	import { rebuildBlockquoteRaw } from '../../schema/container-raw';
	import { createBlockquoteOverrides } from '../../editor-actions/blockquote-context';
	import { createBlockListState } from '../../reactivity/block-list-state.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from '../../editor-actions/nested-actions';
	import { dispatchFocusByPath, dispatchFocusAtColumn } from '../../editor-actions/focus-dispatch';
	import BlockList from '../BlockList.svelte';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const controller = getContext<UndoController>(CONTROLLER_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);

	const state = createBlockListState(() => node);

	const bundle = createStandardNestedActions(
		state,
		{
			get index() {
				return index;
			},
			get node() {
				return node;
			},
			rebuildRaw: () => rebuildBlockquoteRaw(node),
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
			state,
			parentBlockEdit,
			parentFocus,
			controller
		})
	);

	setNestedActionsContexts(bundle);

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export function focus(offset: number): void {
		if (!node.children || node.children.length === 0) return;
		if (offset === 0) {
			state.innerBlockRefs[0]?.focus(0);
		} else {
			const last = node.children.length - 1;
			state.innerBlockRefs[last]?.focus(CURSOR_END);
		}
	}

	export function getCursorOffset(): number | null {
		for (const ref of state.innerBlockRefs) {
			const offset = ref?.getCursorOffset();
			if (offset !== null && offset !== undefined) return offset;
		}
		return null;
	}

	export function focusByPath(path: number[], offset: number): void {
		dispatchFocusByPath(state.innerBlockRefs, path, offset);
	}

	export function focusAtColumn(x: number, from: StickyColumnDirection): void {
		dispatchFocusAtColumn(state.innerBlockRefs, x, from);
	}

	void ({
		editable,
		focusable,
		focus,
		getCursorOffset,
		focusByPath,
		focusAtColumn
	} satisfies BlockComponent);
</script>

<div class="blockquote-block">
	<BlockList
		children={node.children ?? []}
		blockIds={state.innerBlockIds}
		bind:blockRefs={state.innerBlockRefs}
		parentPath={myPath}
	/>
</div>

<style>
	.blockquote-block {
		border-left: 3px solid var(--color-ui-muted, #555);
		padding-left: 16px;
		margin: 4px 0;
	}
</style>
