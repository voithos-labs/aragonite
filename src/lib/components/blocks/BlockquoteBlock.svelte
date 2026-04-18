<script lang="ts">
	import { getContext } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		FOCUS_KEY,
		CONTAINER_EDIT_KEY,
		STICKY_COLUMN_KEY,
		CURSOR_END,
		type BlockEditActions,
		type FocusActions,
		type ContainerEditActions,
		type StickyColumnDirection,
		type CstNode,
		type BlockComponent
	} from '../../contracts';
	import type { StickyColumnState } from '../../contenteditable/sticky-column';
	import { rebuildBlockquoteRaw } from '../../tree-operations/container-raw';
	import { createBlockquoteOverrides } from '../../tree-operations/blockquote-context';
	import { createBlockListState } from './container-state/block-list-state.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from './container-state/nested-actions';
	import { dispatchFocusByPath, dispatchFocusAtColumn } from './container-state/focus-dispatch';
	import BlockList from '../BlockList.svelte';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions | undefined>(CONTAINER_EDIT_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);

	const state = createBlockListState(() => node);

	const bundle = createStandardNestedActions(
		state,
		{
			// Reactive props via getters — factory closures always read the
			// current values (resilient to parent splitBlock shifting index or
			// undo/redo cloning the tree).
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
			parentContainerEdit
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
