/**
 * Convenience factory for container nestedActions bundles. Produces a
 * complete { blockEdit, focus, containerEdit } triple from a state bundle
 * + a container's own raw rebuild function. Containers that need custom
 * behavior (list's U1/M1, blockquote's U2) override specific methods
 * after calling this factory.
 *
 * HistoryActions is intentionally NOT in the bundle — containers never
 * override history; Svelte context walking delivers the document-level
 * HISTORY_KEY to any descendant that reads it.
 */

import { setContext, tick } from 'svelte';
import type {
	BlockEditActions,
	FocusActions,
	ContainerEditActions,
	FocusPosition,
	CstNode
} from '../../../contracts';
import { BLOCK_EDIT_KEY, FOCUS_KEY, CONTAINER_EDIT_KEY, CURSOR_END } from '../../../contracts';
import type { StickyColumnState } from '../../../contenteditable/sticky-column';
import type { BlockListState } from './block-list-state.svelte';
import { dispatchMoveFocus } from './focus-dispatch';
import {
	splitNode as performSplit,
	mergeWithPrevious as performMerge,
	mergeWithNext as performMergeNext,
	deleteNode as performDelete,
	updateNodeContent as performUpdate,
	buildPastedReplacement,
	normalizeReplacementTrivia
} from '../../../tree-operations';
import { generateBlockId } from '../../../tree-operations/block-id';
import { isMergeEligible, isBlockEditable } from '../../../tree-operations/merge-rules';
import { parseAllInlineContent } from '../../../core/inline';
import { displayLength, trimTrailingLineEnding } from '../../../core/lines';

export interface NestedActionsBundle {
	blockEdit: BlockEditActions;
	focus: FocusActions;
	containerEdit: ContainerEditActions;
}

export interface NestedActionsDeps {
	/** The container's own index in its parent's children array. */
	index: number;
	/** The container's CstNode (accessed inside method bodies for kind-specific raw rebuilds). */
	node: CstNode;
	/** Rebuild the container's `raw` after its inner children change. */
	rebuildRaw: () => void;
	/** Sticky column state (passed through from the editor root's context). */
	stickyColumn: StickyColumnState;
	/** Parent sub-interface bundles for delegation. */
	parent: {
		blockEdit: BlockEditActions;
		focus: FocusActions;
		containerEdit?: ContainerEditActions;
	};
}

/**
 * Override factory: receives stable default bundle references and returns
 * per-sub-interface partial overrides. Chain to defaults via
 * `defaults.blockEdit.foo(...)` — the reference is stable across reactivity.
 */
export type NestedActionsOverrideFactory = (defaults: NestedActionsBundle) => {
	blockEdit?: Partial<BlockEditActions>;
	focus?: Partial<FocusActions>;
	containerEdit?: Partial<ContainerEditActions>;
};

/**
 * Produce a NestedActionsBundle. Pass `overrideFactory` for custom behavior
 * (list U1/M1, blockquote U2); overrides chain to factory defaults via the
 * `defaults` argument. Override set is visible at the call site and type-checked.
 */
export function createStandardNestedActions(
	state: BlockListState,
	deps: NestedActionsDeps,
	overrideFactory?: NestedActionsOverrideFactory
): NestedActionsBundle {
	// Note: `index` and `node` are intentionally NOT destructured. Containers
	// pass both via getter properties (`get index()` / `get node()`) so that
	// factory closures always read the current reactive prop values. Passing
	// by value would capture stale snapshots: `index` after a parent structural
	// op shifts the container's position, and `node` after undo/redo replaces
	// the document tree with a cloned snapshot.
	const { rebuildRaw, stickyColumn, parent } = deps;

	function finalizeContainerEdit(): void {
		rebuildRaw();
		parent.containerEdit?.endContainerEdit();
	}

	const blockEdit: BlockEditActions = {
		async splitBlock(innerIndex: number, offset: number): Promise<void> {
			if (!deps.node.children) return;
			parent.containerEdit?.beginContainerEdit(deps.index, offset);
			state.commitChildrenEdit((children, ids, refs) => {
				performSplit({ children }, ids, innerIndex, offset);
				refs.splice(innerIndex + 1, 0, undefined);
			});
			finalizeContainerEdit();
			await tick();
			state.innerBlockRefs[innerIndex + 1]?.focus(0);
		},

		async mergeWithPrevious(innerIndex: number): Promise<void> {
			if (!deps.node.children) return;

			// innerIndex === 0: delegate upward. Containers that override for unwrap
			// (BlockquoteBlock U2, ListBlock U1/M1) override this whole method.
			if (innerIndex <= 0) {
				parent.blockEdit.mergeWithPrevious(deps.index);
				return;
			}

			const prevKind = deps.node.children[innerIndex - 1].kind;
			const currKind = deps.node.children[innerIndex].kind;

			if (isMergeEligible(prevKind, currKind)) {
				const mergeOffset = displayLength(deps.node.children[innerIndex - 1].raw);
				parent.containerEdit?.beginContainerEdit(deps.index, 0);
				state.commitChildrenEdit((children, ids, refs) => {
					performMerge({ children }, ids, innerIndex);
					refs.splice(innerIndex, 1);
				});
				finalizeContainerEdit();
				await tick();
				state.innerBlockRefs[innerIndex - 1]?.focus(mergeOffset);
			} else if (!isBlockEditable(prevKind)) {
				parent.containerEdit?.beginContainerEdit(deps.index, 0);
				state.commitChildrenEdit((children, ids, refs) => {
					performDelete({ children }, ids, innerIndex - 1);
					refs.splice(innerIndex - 1, 1);
				});
				finalizeContainerEdit();
				await tick();
				state.innerBlockRefs[innerIndex - 1]?.focus(0);
			} else {
				state.innerBlockRefs[innerIndex - 1]?.focus(CURSOR_END);
			}
		},

		async mergeWithNext(innerIndex: number): Promise<void> {
			if (!deps.node.children) return;

			if (innerIndex >= deps.node.children.length - 1) {
				parent.blockEdit.mergeWithNext(deps.index);
				return;
			}

			const currKind = deps.node.children[innerIndex].kind;
			const nextKind = deps.node.children[innerIndex + 1].kind;

			if (isMergeEligible(currKind, nextKind)) {
				const mergeOffset = displayLength(deps.node.children[innerIndex].raw);
				parent.containerEdit?.beginContainerEdit(deps.index, 0);
				state.commitChildrenEdit((children, ids, refs) => {
					performMergeNext({ children }, ids, innerIndex);
					refs.splice(innerIndex + 1, 1);
				});
				finalizeContainerEdit();
				await tick();
				state.innerBlockRefs[innerIndex]?.focus(mergeOffset);
			} else if (!isBlockEditable(nextKind)) {
				parent.containerEdit?.beginContainerEdit(deps.index, 0);
				state.commitChildrenEdit((children, ids, refs) => {
					performDelete({ children }, ids, innerIndex + 1);
					refs.splice(innerIndex + 1, 1);
				});
				finalizeContainerEdit();
				await tick();
				state.innerBlockRefs[innerIndex]?.focus(CURSOR_END);
			} else {
				state.innerBlockRefs[innerIndex + 1]?.focus(0);
			}
		},

		async deleteBlock(innerIndex: number): Promise<void> {
			if (!deps.node.children) return;

			if (deps.node.children.length <= 1) {
				parent.blockEdit.deleteBlock(deps.index);
				return;
			}

			parent.containerEdit?.beginContainerEdit(deps.index, 0);
			state.commitChildrenEdit((children, ids, refs) => {
				performDelete({ children }, ids, innerIndex);
				refs.splice(innerIndex, 1);
			});
			finalizeContainerEdit();
			await tick();
			const focusIdx = Math.min(innerIndex, deps.node.children.length - 1);
			state.innerBlockRefs[focusIdx]?.focus(0);
		},

		async updateBlockContent(
			innerIndex: number,
			text: string,
			preEditOffset?: number
		): Promise<void> {
			if (!deps.node.children) return;
			parent.containerEdit?.beginContainerEditDebounced(deps.index, preEditOffset ?? 0);
			const result = performUpdate({ children: deps.node.children }, innerIndex, text);
			rebuildRaw();
			parent.containerEdit?.endContainerEdit();
			if (result.kindChanged) {
				state.triggerReactivity();
					await tick();
				state.innerBlockRefs[innerIndex]?.focus(preEditOffset ?? 0);
			}
		},

		async insertParsedBlocks(
			innerIndex: number,
			offset: number,
			blocks: CstNode[],
			preDelete?: { start: number; end: number },
			options?: { skipSnapshot?: boolean }
		): Promise<void> {
			if (!deps.node.children || blocks.length === 0) return;
			if (innerIndex < 0 || innerIndex >= deps.node.children.length) return;

			// Fold any preDelete into a synthesized leaf so the single replaceBlock
			// call covers both delete and paste as one undo entry.
			const currentNode = deps.node.children[innerIndex];
			let synthLeaf = currentNode;
			let effectiveOffset = offset;
			if (preDelete && preDelete.start < preDelete.end) {
				const display = trimTrailingLineEnding(currentNode.raw);
				const lineEnd = currentNode.raw.endsWith('\r\n') ? '\r\n' : '\n';
				const effectiveRaw =
					display.slice(0, preDelete.start) + display.slice(preDelete.end) + lineEnd;
				synthLeaf = { ...currentNode, raw: effectiveRaw };
				effectiveOffset = preDelete.start;
			}
			const replacement = buildPastedReplacement(synthLeaf, effectiveOffset, blocks);
			await blockEdit.replaceBlock(
				innerIndex,
				replacement,
				{
					replacementIndex: replacement.length - 1,
					offset: CURSOR_END
				},
				options
			);
		},

		async replaceBlock(
			innerIndex: number,
			replacement: CstNode[],
			focus?: { replacementIndex: number; offset: number },
			options?: { skipSnapshot?: boolean }
		): Promise<void> {
			if (!deps.node.children || innerIndex < 0 || innerIndex >= deps.node.children.length) return;

			// skipSnapshot: the caller already pushed a snapshot covering the whole
			// delete-then-paste; skip to avoid a duplicate entry.
			if (!options?.skipSnapshot) {
				parent.containerEdit?.beginContainerEdit(deps.index, 0);
			}

			state.commitChildrenEdit((children, ids, refs) => {
				if (replacement.length === 0) {
					children.splice(innerIndex, 1);
					ids.splice(innerIndex, 1);
					refs.splice(innerIndex, 1);
				} else {
					const normalizedReplacement = normalizeReplacementTrivia(
						children[innerIndex],
						replacement
					);
					parseAllInlineContent(normalizedReplacement);
					children.splice(innerIndex, 1, ...normalizedReplacement);
					ids.splice(innerIndex, 1, ...normalizedReplacement.map(() => generateBlockId()));
					refs.splice(innerIndex, 1, ...new Array(normalizedReplacement.length).fill(undefined));
				}
			});

			rebuildRaw();
			parent.containerEdit?.endContainerEdit();

			await tick();

			if (focus && replacement.length > 0) {
				const targetIdx = innerIndex + focus.replacementIndex;
				state.innerBlockRefs[targetIdx]?.focus(focus.offset);
			}
		}
	};

	const focus: FocusActions = {
		async moveFocus(innerIndex: number, position: FocusPosition): Promise<void> {
			// node.children.length is authoritative — refs.length lags after
			// structural ops because bind:this fires asynchronously.
			await dispatchMoveFocus(
				state.innerBlockRefs,
				innerIndex,
				position,
				stickyColumn,
				{
					focus: parent.focus,
					index: deps.index
				},
				deps.node.children?.length
			);
		}
	};

	const containerEdit: ContainerEditActions = {
		beginContainerEdit(_innerIndex: number, offset: number): void {
			parent.containerEdit?.beginContainerEdit(deps.index, offset);
		},

		beginContainerEditDebounced(_innerIndex: number, offset: number): void {
			parent.containerEdit?.beginContainerEditDebounced(deps.index, offset);
		},

		endContainerEdit(): void {
			rebuildRaw();
			parent.containerEdit?.endContainerEdit();
		}
	};

	const defaults: NestedActionsBundle = { blockEdit, focus, containerEdit };
	if (!overrideFactory) return defaults;

	const overrides = overrideFactory(defaults);
	return {
		blockEdit: { ...blockEdit, ...(overrides.blockEdit ?? {}) },
		focus: { ...focus, ...(overrides.focus ?? {}) },
		containerEdit: { ...containerEdit, ...(overrides.containerEdit ?? {}) }
	};
}

/**
 * Set the three container sub-interface contexts in one call. Containers
 * call this after building a bundle (via createStandardNestedActions or
 * a custom override pattern).
 */
export function setNestedActionsContexts(bundle: NestedActionsBundle): void {
	setContext(BLOCK_EDIT_KEY, bundle.blockEdit);
	setContext(FOCUS_KEY, bundle.focus);
	setContext(CONTAINER_EDIT_KEY, bundle.containerEdit);
}
