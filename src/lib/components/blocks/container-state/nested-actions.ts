/**
 * Factory for container nestedActions bundles — produces a complete
 * { blockEdit, focus, containerEdit } triple from a state bundle and the
 * container's raw rebuild. HistoryActions is deliberately absent: containers
 * never override history; Svelte context delivers the document-level
 * HISTORY_KEY to any descendant.
 */

import { setContext } from 'svelte';
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
import { isMergeEligible, isBlockEditable } from '../../../tree-operations/merge-rules';
import { parseAllInlineContent } from '../../../core/inline';
import { displayLength, trimTrailingLineEnding } from '../../../core/lines';

export interface NestedActionsBundle {
	blockEdit: BlockEditActions;
	focus: FocusActions;
	containerEdit: ContainerEditActions;
}

export interface NestedActionsDeps {
	index: number;
	node: CstNode;
	rebuildRaw: () => void;
	stickyColumn: StickyColumnState;
	parent: {
		blockEdit: BlockEditActions;
		focus: FocusActions;
		containerEdit?: ContainerEditActions;
	};
}

/**
 * Receives stable default bundle references and returns per-sub-interface
 * partial overrides. Chain via `defaults.blockEdit.foo(...)`.
 */
export type NestedActionsOverrideFactory = (defaults: NestedActionsBundle) => {
	blockEdit?: Partial<BlockEditActions>;
	focus?: Partial<FocusActions>;
	containerEdit?: Partial<ContainerEditActions>;
};

export function createStandardNestedActions(
	state: BlockListState,
	deps: NestedActionsDeps,
	overrideFactory?: NestedActionsOverrideFactory
): NestedActionsBundle {
	// `index` and `node` are intentionally not destructured: containers expose
	// both as getters (`get index()`, `get node()`) so closures read live
	// reactive values. Destructuring would capture stale snapshots after a
	// parent structural op or undo/redo replacement.
	const { rebuildRaw, stickyColumn, parent } = deps;

	const blockEdit: BlockEditActions = {
		async splitBlock(innerIndex: number, offset: number): Promise<void> {
			if (!deps.node.children) return;
			await parent.containerEdit!.commitContainer(
				deps.node,
				state,
				{ blockIndex: deps.index, offset },
				(children) => {
					const change = performSplit({ children }, innerIndex, offset);
					// Sync before rebuildRaw — it reads deps.node.children directly.
					deps.node.children = children;
					rebuildRaw();
					return change;
				},
				() => {
					state.innerBlockRefs[innerIndex + 1]?.focus(0);
				},
				{ kind: 'split', eventPath: [deps.index, innerIndex] }
			);
		},

		async mergeWithPrevious(innerIndex: number): Promise<void> {
			if (!deps.node.children) return;

			// innerIndex === 0: delegate upward. Unwrap-style containers
			// (BlockquoteBlock U2, ListBlock U1/M1) override this whole method.
			if (innerIndex <= 0) {
				parent.blockEdit.mergeWithPrevious(deps.index);
				return;
			}

			const prevKind = deps.node.children[innerIndex - 1].kind;
			const currKind = deps.node.children[innerIndex].kind;

			if (isMergeEligible(prevKind, currKind)) {
				const mergeOffset = displayLength(deps.node.children[innerIndex - 1].raw);
				await parent.containerEdit!.commitContainer(
					deps.node,
					state,
					{ blockIndex: deps.index, offset: 0 },
					(children) => {
						const change = performMerge({ children }, innerIndex);
						deps.node.children = children;
						rebuildRaw();
						return change;
					},
					() => {
						state.innerBlockRefs[innerIndex - 1]?.focus(mergeOffset);
					},
					{
						kind: 'merge',
						detail: { direction: 'prev' },
						eventPath: [deps.index, innerIndex]
					}
				);
			} else if (!isBlockEditable(prevKind)) {
				await parent.containerEdit!.commitContainer(
					deps.node,
					state,
					{ blockIndex: deps.index, offset: 0 },
					(children) => {
						const change = performDelete({ children }, innerIndex - 1);
						deps.node.children = children;
						rebuildRaw();
						return change;
					},
					() => {
						state.innerBlockRefs[innerIndex - 1]?.focus(0);
					},
					{ kind: 'delete', eventPath: [deps.index, innerIndex - 1] }
				);
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
				await parent.containerEdit!.commitContainer(
					deps.node,
					state,
					{ blockIndex: deps.index, offset: 0 },
					(children) => {
						const change = performMergeNext({ children }, innerIndex);
						deps.node.children = children;
						rebuildRaw();
						return change;
					},
					() => {
						state.innerBlockRefs[innerIndex]?.focus(mergeOffset);
					},
					{
						kind: 'merge',
						detail: { direction: 'next' },
						eventPath: [deps.index, innerIndex]
					}
				);
			} else if (!isBlockEditable(nextKind)) {
				await parent.containerEdit!.commitContainer(
					deps.node,
					state,
					{ blockIndex: deps.index, offset: 0 },
					(children) => {
						const change = performDelete({ children }, innerIndex + 1);
						deps.node.children = children;
						rebuildRaw();
						return change;
					},
					() => {
						state.innerBlockRefs[innerIndex]?.focus(CURSOR_END);
					},
					{ kind: 'delete', eventPath: [deps.index, innerIndex + 1] }
				);
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

			await parent.containerEdit!.commitContainer(
				deps.node,
				state,
				{ blockIndex: deps.index, offset: 0 },
				(children) => {
					const change = performDelete({ children }, innerIndex);
					deps.node.children = children;
					rebuildRaw();
					return change;
				},
				() => {
					const focusIdx = Math.min(innerIndex, (deps.node.children?.length ?? 1) - 1);
					state.innerBlockRefs[focusIdx]?.focus(0);
				},
				{ kind: 'delete', eventPath: [deps.index, innerIndex] }
			);
		},

		async updateBlockContent(
			innerIndex: number,
			text: string,
			preEditOffset?: number
		): Promise<void> {
			if (!deps.node.children) return;

			// Preview on shallow-cloned children to pick between structural
			// (kind-changing) commit and routine typing path. Live tree is not
			// mutated here — the chosen branch runs the real mutation below.
			const preview = performUpdate(
				{ children: deps.node.children.map((c) => ({ ...c })) },
				innerIndex,
				text
			);

			if (preview.kindChanged) {
				await parent.containerEdit!.commitContainer(
					deps.node,
					state,
					{ blockIndex: deps.index, offset: preEditOffset ?? 0 },
					(children) => {
						performUpdate({ children }, innerIndex, text);
						deps.node.children = children;
						rebuildRaw();
						return { op: 'noop' };
					},
					() => {
						state.innerBlockRefs[innerIndex]?.focus(preEditOffset ?? 0);
					},
					{
						kind: 'updateContent',
						detail: { length: text.length },
						eventPath: [deps.index, innerIndex]
					}
				);
				return;
			}

			// Routine typing — debounced undo path, no structural commit.
			parent.containerEdit?.beginContainerEditDebounced(deps.index, preEditOffset ?? 0);
			performUpdate({ children: deps.node.children }, innerIndex, text);
			rebuildRaw();
			parent.containerEdit?.endContainerEdit();
		},

		async updateBlockMetadata(
			innerIndex: number,
			metadata: Record<string, unknown>,
			options?: { skipSnapshot?: boolean }
		): Promise<void> {
			if (!deps.node.children || innerIndex < 0 || innerIndex >= deps.node.children.length) return;
			const fields = Object.keys(metadata);
			if (fields.length === 0) return;

			await parent.containerEdit!.commitContainer(
				deps.node,
				state,
				options?.skipSnapshot ? 'skip' : { blockIndex: deps.index, offset: 0 },
				() => {
					const node = deps.node.children![innerIndex];
					node.metadata = { ...(node.metadata ?? {}), ...metadata } as typeof node.metadata;
					return { op: 'noop' };
				},
				undefined,
				{
					kind: 'metadataUpdate',
					detail: { fields },
					eventPath: [deps.index, innerIndex]
				}
			);
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

			// Fold preDelete into a synthesized leaf so one replaceBlock call
			// covers both delete and paste as a single undo entry.
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

			// skipSnapshot: caller already pushed a snapshot covering the whole
			// delete-then-paste — skip to avoid duplicating the entry.
			const snapshot = options?.skipSnapshot
				? ('skip' as const)
				: { blockIndex: deps.index, offset: 0 };

			await parent.containerEdit!.commitContainer(
				deps.node,
				state,
				snapshot,
				(children) => {
					if (replacement.length === 0) {
						children.splice(innerIndex, 1);
						deps.node.children = children;
						rebuildRaw();
						return { op: 'delete', at: innerIndex, count: 1 };
					}
					const normalizedReplacement = normalizeReplacementTrivia(
						children[innerIndex],
						replacement
					);
					parseAllInlineContent(normalizedReplacement);
					children.splice(innerIndex, 1, ...normalizedReplacement);
					deps.node.children = children;
					rebuildRaw();
					return {
						op: 'replace',
						at: innerIndex,
						count: 1,
						newCount: normalizedReplacement.length
					};
				},
				() => {
					if (focus && replacement.length > 0) {
						const targetIdx = innerIndex + focus.replacementIndex;
						state.innerBlockRefs[targetIdx]?.focus(focus.offset);
					}
				},
				{
					kind: replacement.length === 0 ? 'delete' : 'replaceBlock',
					eventPath: [deps.index, innerIndex]
				}
			);
		}
	};

	const focus: FocusActions = {
		async moveFocus(innerIndex: number, position: FocusPosition): Promise<void> {
			// node.children.length is authoritative: refs.length lags after
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
		},

		commitContainer(containerNode, innerState, snapshot, mutate, afterTick, op): Promise<void> {
			// Forward to the enclosing container, remapping the snapshot's
			// blockIndex to this container's own doc-relative index and prepending
			// `deps.index` to the edit event path. Inner containerNode/innerState/
			// mutate/afterTick pass through unchanged — they describe the inner
			// mutation, not the ancestry.
			if (!parent.containerEdit) return Promise.resolve();
			const remappedSnapshot =
				snapshot === 'skip' ? snapshot : { blockIndex: deps.index, offset: snapshot.offset };
			const remappedOp = op
				? {
						kind: op.kind,
						detail: op.detail,
						eventPath: [deps.index, ...op.eventPath]
					}
				: undefined;
			// Ancestry raw must rebuild whenever a descendant mutates — wrap the
			// inner mutate so our rebuildRaw runs after it.
			const wrappedMutate = (children: CstNode[]) => {
				const change = mutate(children);
				rebuildRaw();
				return change;
			};
			return parent.containerEdit.commitContainer(
				containerNode,
				innerState,
				remappedSnapshot,
				wrappedMutate,
				afterTick,
				remappedOp
			);
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

/** Set the three container sub-interface contexts in one call. */
export function setNestedActionsContexts(bundle: NestedActionsBundle): void {
	setContext(BLOCK_EDIT_KEY, bundle.blockEdit);
	setContext(FOCUS_KEY, bundle.focus);
	setContext(CONTAINER_EDIT_KEY, bundle.containerEdit);
}
