<script lang="ts">
	import { getContext, setContext, tick } from 'svelte';
	import {
		EDITOR_ACTIONS_KEY,
		CURSOR_END,
		type EditorActions,
		type CstNode,
		type BlockComponent
	} from '../../editor-types';
	import { assignIds, generateBlockId } from '../../mutable-tree';
	import { displayLength } from '../../core/text-utils';
	import {
		splitNode as performSplit,
		mergeWithPrevious as performMerge,
		mergeWithNext as performMergeNext,
		deleteNode as performDelete,
		updateNodeContent as performUpdate,
		unwrapFirstChildFromBlockquote
	} from '../../tree-operations';
	import { isMergeEligible, isBlockEditable } from '../../merge-rules';
	import { rebuildBlockquoteRaw } from '../../container-raw';
	import BlockList from '../BlockList.svelte';

	let { node, index }: { node: CstNode; index: number } = $props();

	const parentActions = getContext<EditorActions>(EDITOR_ACTIONS_KEY);
	let innerBlockIds = $state<string[]>(assignIds(node.children ?? []));
	let innerBlockRefs = $state<(BlockComponent | undefined)[]>([]);

	// Re-sync inner block IDs when children count changes externally (undo/redo).
	// Internal structural ops set innerBlockIds directly via commitChildrenEdit,
	// so this effect is a no-op for those paths.
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
			innerBlockRefs[0]?.focus(0);
		} else {
			const last = node.children.length - 1;
			innerBlockRefs[last]?.focus(CURSOR_END);
		}
	}

	export function getCursorOffset(): number | null {
		for (const ref of innerBlockRefs) {
			const offset = ref?.getCursorOffset();
			if (offset !== null && offset !== undefined) return offset;
		}
		return null;
	}
	/**
	 * Cascade focus down a path of child indices inside this blockquote.
	 * Mirrors ListItemBlock.focusByPath — peels off path[0], delegates to the
	 * child at that index via focus(offset) if the path ends here, or
	 * recursively via focusByPath?(rest, offset) if further descent is needed.
	 * Called by Editor.mergeWithPrevious for cross-container merge focus
	 * cascade when the merge target is inside a blockquote.
	 */
	export function focusByPath(path: number[], offset: number): void {
		if (path.length === 0 || !node.children) return;
		const [first, ...rest] = path;
		const child = innerBlockRefs[first];
		if (!child) return;
		if (rest.length === 0) {
			child.focus(offset);
		} else {
			child.focusByPath?.(rest, offset);
		}
	}

	void ({ editable, focusable, focus, getCursorOffset, focusByPath } satisfies BlockComponent);

	// ── Helpers ──────────────────────────────────────────────────────────

	function asNodeParent(): { children: CstNode[] } {
		return { children: node.children! };
	}

	function finalizeContainerEdit(): void {
		rebuildBlockquoteRaw(node);
		parentActions.endContainerEdit?.();
	}

	/**
	 * Apply a structural mutation to children/ids/refs on plain-array copies,
	 * then publish all three in one commit. This mirrors Editor.svelte's
	 * splitBlock/merge/delete pattern: splicing directly on $state proxies
	 * (or on node.children, whose parent is a proxy) during a keyed {#each}
	 * re-render interleaves reactivity with the mutation and can leave
	 * `innerBlockRefs` out of sync with the rendered components — bind:ref
	 * in a keyed each only fires on mount, so shifted or re-mounted children
	 * can't rebind an already-populated slot. Committing all three arrays at
	 * once gives Svelte a consistent snapshot to diff against and keeps the
	 * refs array aligned with the shifted components.
	 */
	function commitChildrenEdit(
		mutate: (
			childrenCopy: CstNode[],
			idsCopy: string[],
			refsCopy: (BlockComponent | undefined)[]
		) => void
	): void {
		const childrenCopy = [...(node.children ?? [])];
		const idsCopy = [...innerBlockIds];
		const refsCopy = [...innerBlockRefs];
		mutate(childrenCopy, idsCopy, refsCopy);
		node.children = childrenCopy;
		innerBlockIds = idsCopy;
		innerBlockRefs = refsCopy;
	}

	// ── Nested EditorActions ─────────────────────────────────────────────

	const nestedActions: EditorActions = {
		async splitBlock(innerIndex: number, offset: number): Promise<void> {
			if (!node.children) return;

			// Enter on empty trailing paragraph — exit the blockquote
			const child = node.children[innerIndex];
			const isLastChild = innerIndex === node.children.length - 1;
			const isEmpty = child.kind === 'paragraph' && child.raw.trim() === '';
			if (isLastChild && isEmpty) {
				if (node.children.length <= 1) {
					// Only child is empty — replace blockquote with a new paragraph
					parentActions.splitBlock(index, displayLength(node.raw));
				} else {
					// Remove the empty child, rebuild, then focus block after
					parentActions.beginContainerEdit?.(index, 0);
					commitChildrenEdit((children, ids, refs) => {
						performDelete({ children }, ids, innerIndex);
						refs.splice(innerIndex, 1);
					});
					finalizeContainerEdit();
					await tick();
					parentActions.moveFocus(index + 1, 'start');
				}
				return;
			}

			parentActions.beginContainerEdit?.(index, offset);
			commitChildrenEdit((children, ids, refs) => {
				performSplit({ children }, ids, innerIndex, offset);
				// New child inserted at innerIndex+1. Splice an undefined slot so
				// existing refs for shifted children stay aligned; the newly
				// mounted component lands in the empty slot.
				refs.splice(innerIndex + 1, 0, undefined);
			});
			finalizeContainerEdit();
			await tick();
			innerBlockRefs[innerIndex + 1]?.focus(0);
		},

		async mergeWithPrevious(innerIndex: number): Promise<void> {
			if (!node.children) return;

			if (innerIndex <= 0) {
				// Rule U2 — unwrap first child out of the blockquote.
				const replacement = unwrapFirstChildFromBlockquote(node);
				if (replacement.length === 0) return;
				await parentActions.replaceBlock(index, replacement, { replacementIndex: 0, offset: 0 });
				return;
			}

			const prevKind = node.children[innerIndex - 1].kind;
			const currKind = node.children[innerIndex].kind;

			if (isMergeEligible(prevKind, currKind)) {
				const mergeOffset = displayLength(node.children[innerIndex - 1].raw);

				parentActions.beginContainerEdit?.(index, 0);
				commitChildrenEdit((children, ids, refs) => {
					performMerge({ children }, ids, innerIndex);
					refs.splice(innerIndex, 1);
				});
				finalizeContainerEdit();
				await tick();
				innerBlockRefs[innerIndex - 1]?.focus(mergeOffset);
			} else if (!isBlockEditable(prevKind)) {
				parentActions.beginContainerEdit?.(index, 0);
				commitChildrenEdit((children, ids, refs) => {
					performDelete({ children }, ids, innerIndex - 1);
					refs.splice(innerIndex - 1, 1);
				});
				finalizeContainerEdit();
				await tick();
				innerBlockRefs[innerIndex - 1]?.focus(0);
			} else {
				innerBlockRefs[innerIndex - 1]?.focus(CURSOR_END);
			}
		},

		async mergeWithNext(innerIndex: number): Promise<void> {
			if (!node.children) return;

			if (innerIndex >= node.children.length - 1) {
				// At last child — cross boundary downward
				parentActions.mergeWithNext(index);
				return;
			}

			const currKind = node.children[innerIndex].kind;
			const nextKind = node.children[innerIndex + 1].kind;

			if (isMergeEligible(currKind, nextKind)) {
				const mergeOffset = displayLength(node.children[innerIndex].raw);

				parentActions.beginContainerEdit?.(index, 0);
				commitChildrenEdit((children, ids, refs) => {
					performMergeNext({ children }, ids, innerIndex);
					refs.splice(innerIndex + 1, 1);
				});
				finalizeContainerEdit();
				await tick();
				innerBlockRefs[innerIndex]?.focus(mergeOffset);
			} else if (!isBlockEditable(nextKind)) {
				parentActions.beginContainerEdit?.(index, 0);
				commitChildrenEdit((children, ids, refs) => {
					performDelete({ children }, ids, innerIndex + 1);
					refs.splice(innerIndex + 1, 1);
				});
				finalizeContainerEdit();
				await tick();
				innerBlockRefs[innerIndex]?.focus(CURSOR_END);
			} else {
				innerBlockRefs[innerIndex + 1]?.focus(0);
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
			commitChildrenEdit((children, ids, refs) => {
				performDelete({ children }, ids, innerIndex);
				refs.splice(innerIndex, 1);
			});
			finalizeContainerEdit();
			await tick();
			const focusIdx = Math.min(innerIndex, node.children.length - 1);
			innerBlockRefs[focusIdx]?.focus(0);
		},

		async moveFocus(innerIndex: number, position: 'start' | 'end' | number): Promise<void> {
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
				if (typeof position === 'number') block.focus(position);
				else if (position === 'start') block.focus(0);
				else block.focus(CURSOR_END);
			}
		},

		updateBlockContent(innerIndex: number, text: string, preEditOffset?: number): void {
			if (!node.children) return;
			parentActions.beginContainerEditDebounced?.(index, preEditOffset ?? 0);
			const result = performUpdate(asNodeParent(), innerIndex, text);
			rebuildBlockquoteRaw(node);
			parentActions.endContainerEdit?.();
			if (result.kindChanged) {
				// Force re-mount of the in-place kind-swapped child by re-spreading
				// node.children. Child count is unchanged, so innerBlockIds stays put.
				node.children = [...(node.children ?? [])];
				tick().then(() => {
					innerBlockRefs[innerIndex]?.focus(text.length > 0 ? text.length - 1 : 0);
				});
			}
		},

		// insertParsedBlocks inside blockquote: not yet supported (paste is inline only within containers)
		async insertParsedBlocks(): Promise<void> {},

		async replaceBlock(
			innerIndex: number,
			replacement: CstNode[],
			focus?: { replacementIndex: number; offset: number }
		): Promise<void> {
			if (!node.children || innerIndex < 0 || innerIndex >= node.children.length) return;

			parentActions.beginContainerEdit?.(index, 0);

			commitChildrenEdit((children, ids, refs) => {
				if (replacement.length === 0) {
					children.splice(innerIndex, 1);
					ids.splice(innerIndex, 1);
					refs.splice(innerIndex, 1);
				} else {
					const originalTrivia = node.children![innerIndex].leadingTrivia ?? '';
					const normalizedReplacement = replacement.map((replacementNode, i) => {
						const copy = { ...replacementNode };
						copy.leadingTrivia = i === 0 ? originalTrivia : (copy.leadingTrivia ?? '');
						return copy;
					});
					children.splice(innerIndex, 1, ...normalizedReplacement);
					ids.splice(innerIndex, 1, ...normalizedReplacement.map(() => generateBlockId()));
					const newRefSlots: (BlockComponent | undefined)[] = new Array(
						normalizedReplacement.length
					).fill(undefined);
					refs.splice(innerIndex, 1, ...newRefSlots);
				}
			});

			rebuildBlockquoteRaw(node);
			parentActions.endContainerEdit?.();

			await tick();

			if (focus && replacement.length > 0) {
				const targetIdx = innerIndex + focus.replacementIndex;
				innerBlockRefs[targetIdx]?.focus(focus.offset);
			}
		},

		requestUndo(): void | Promise<void> {
			return parentActions.requestUndo();
		},

		requestRedo(): void | Promise<void> {
			return parentActions.requestRedo();
		},

		// Propagate container support for deeply nested containers
		beginContainerEdit(_blockIndex: number, offset: number): void {
			parentActions.beginContainerEdit?.(index, offset);
		},

		beginContainerEditDebounced(_blockIndex: number, offset: number): void {
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
