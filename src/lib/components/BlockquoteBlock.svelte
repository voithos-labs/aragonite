<script lang="ts">
	import { getContext, setContext, tick } from 'svelte';
	import {
		EDITOR_ACTIONS_KEY,
		type EditorActions,
		type CstNode,
		type BlockComponent
	} from '../editor-types';
	import { assignIds } from '../mutable-tree';
	import {
		splitNode as performSplit,
		mergeWithPrevious as performMerge,
		deleteNode as performDelete,
		updateNodeContent as performUpdate
	} from '../tree-operations';
	import { isMergeEligible, isBlockEditable } from '../merge-rules';
	import { rebuildBlockquoteRaw } from '../container-raw';
	import BlockList from './BlockList.svelte';

	let { node, index }: { node: CstNode; index: number } = $props();

	const parentActions = getContext<EditorActions>(EDITOR_ACTIONS_KEY);
	let innerBlockIds = $state<string[]>(assignIds(node.children ?? []));
	let innerBlockRefs = $state<(BlockComponent | undefined)[]>([]);

	// Re-sync inner block IDs when children count changes externally (undo/redo).
	// Internal operations (split/merge) update innerBlockIds directly via
	// triggerInnerReactivity(), so the effect is a no-op for those.
	$effect(() => {
		const childCount = (node.children ?? []).length;
		if (childCount !== innerBlockIds.length) {
			innerBlockIds = assignIds(node.children ?? []);
		}
	});

	// ── BlockComponent interface ─────────────────────────────────────────

	// Containers are editable (they hold text content via inner children).
	// This matters for merge eligibility: Backspace from the block after a
	// container should move focus into it, not delete it. isMergeEligible
	// already blocks direct text merging with containers.
	export const editable = true;
	export const focusable = true;

	export function focus(offset: number): void {
		if (!node.children || node.children.length === 0) return;
		// Container focus only supports two modes: start (offset 0) → first
		// child, or end (any non-zero offset) → last child. Numeric raw-text
		// offsets cannot meaningfully map into nested children. If undo
		// restores focus to a container, it routes to the nearest edge.
		if (offset === 0) {
			innerBlockRefs[0]?.focus?.(0);
		} else {
			const last = node.children.length - 1;
			innerBlockRefs[last]?.focus?.(999999);
		}
	}

	export function getCursorOffset(): number | null {
		for (const ref of innerBlockRefs) {
			const offset = ref?.getCursorOffset?.();
			if (offset !== null && offset !== undefined) return offset;
		}
		return null;
	}

	// ── Helpers ──────────────────────────────────────────────────────────

	function innerParent(): { children: CstNode[] } {
		return { children: node.children! };
	}

	function rebuildAndNotify(): void {
		rebuildBlockquoteRaw(node);
		parentActions.endContainerEdit?.();
	}

	function triggerInnerReactivity(): void {
		node.children = [...(node.children ?? [])];
		innerBlockIds = [...innerBlockIds];
	}

	// ── Nested EditorActions ─────────────────────────────────────────────

	const nestedActions: EditorActions = {
		async splitBlock(innerIndex: number, offset: number): Promise<void> {
			if (!node.children) return;
			parentActions.beginContainerEdit?.(index, offset);
			performSplit(innerParent(), innerBlockIds, innerIndex, offset);
			rebuildAndNotify();
			triggerInnerReactivity();
			await tick();
			innerBlockRefs[innerIndex + 1]?.focus?.(0);
		},

		async mergeWithPrevious(innerIndex: number): Promise<void> {
			if (!node.children) return;

			if (innerIndex <= 0) {
				// At start of first child — cross boundary upward
				parentActions.moveFocus(index - 1, 'end');
				return;
			}

			const prevKind = node.children[innerIndex - 1].kind;
			const currKind = node.children[innerIndex].kind;

			if (isMergeEligible(prevKind, currKind)) {
				const prevRaw = node.children[innerIndex - 1].raw;
				let mergeOffset = prevRaw.length;
				if (prevRaw.endsWith('\r\n')) mergeOffset -= 2;
				else if (prevRaw.endsWith('\n')) mergeOffset -= 1;

				parentActions.beginContainerEdit?.(index, 0);
				performMerge(innerParent(), innerBlockIds, innerIndex);
				rebuildAndNotify();
				triggerInnerReactivity();
				await tick();
				innerBlockRefs[innerIndex - 1]?.focus?.(mergeOffset);
			} else if (!isBlockEditable(prevKind)) {
				parentActions.beginContainerEdit?.(index, 0);
				performDelete(innerParent(), innerBlockIds, innerIndex - 1);
				rebuildAndNotify();
				triggerInnerReactivity();
				await tick();
				innerBlockRefs[innerIndex - 1]?.focus?.(0);
			} else {
				innerBlockRefs[innerIndex - 1]?.focus?.(999999);
			}
		},

		async deleteBlock(innerIndex: number): Promise<void> {
			if (!node.children) return;

			if (node.children.length <= 1) {
				// Last child — delete entire blockquote
				parentActions.deleteBlock(index);
				return;
			}

			parentActions.beginContainerEdit?.(index, 0);
			performDelete(innerParent(), innerBlockIds, innerIndex);
			rebuildAndNotify();
			triggerInnerReactivity();
			await tick();
			const focusIdx = Math.min(innerIndex, node.children.length - 1);
			innerBlockRefs[focusIdx]?.focus?.(0);
		},

		async moveFocus(
			innerIndex: number,
			position: 'start' | 'end' | number
		): Promise<void> {
			if (!node.children) return;

			if (innerIndex < 0) {
				// Before first child — move before blockquote
				parentActions.moveFocus(index - 1, 'end');
			} else if (innerIndex >= node.children.length) {
				// After last child — move after blockquote
				parentActions.moveFocus(index + 1, 'start');
			} else {
				const block = innerBlockRefs[innerIndex];
				if (!block?.focusable) return;
				if (typeof position === 'number') block.focus?.(position);
				else if (position === 'start') block.focus?.(0);
				else block.focus?.(999999);
			}
		},

		updateBlockContent(
			innerIndex: number,
			text: string,
			preEditOffset?: number
		): void {
			if (!node.children) return;
			parentActions.beginContainerEditDebounced?.(index, preEditOffset ?? 0);
			const result = performUpdate(innerParent(), innerIndex, text);
			rebuildBlockquoteRaw(node);
			if (result.kindChanged) {
				triggerInnerReactivity();
				tick().then(() => {
					innerBlockRefs[innerIndex]?.focus?.(
						text.length > 0 ? text.length - 1 : 0
					);
				});
			}
		},

		requestUndo(): void | Promise<void> {
			return parentActions.requestUndo();
		},

		requestRedo(): void | Promise<void> {
			return parentActions.requestRedo();
		},

		// Propagate container support for deeply nested containers
		beginContainerEdit(blockIndex: number, offset: number): void {
			parentActions.beginContainerEdit?.(index, offset);
		},

		beginContainerEditDebounced(blockIndex: number, offset: number): void {
			parentActions.beginContainerEditDebounced?.(index, offset);
		},

		endContainerEdit(): void {
			rebuildBlockquoteRaw(node);
			parentActions.endContainerEdit?.();
		}
	};

	setContext(EDITOR_ACTIONS_KEY, nestedActions);
</script>

<div class="blockquote-block">
	<BlockList
		children={node.children ?? []}
		blockIds={innerBlockIds}
		bind:blockRefs={innerBlockRefs}
	/>
</div>

<style>
	.blockquote-block {
		border-left: 3px solid var(--color-ui-muted, #555);
		padding-left: 16px;
		margin: 4px 0;
	}
</style>
