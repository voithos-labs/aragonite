/**
 * BlockEditActions factory for container nestedActions bundles. Each method
 * routes mutations through `parent.containerEdit.commitContainer` so the
 * snapshot, op-event, and reactivity ceremony lives in one place.
 */

import type { BlockEditActions } from '../action-contracts';
import { CURSOR_END } from '../block-component';
import type { CstNode } from '../core/nodes';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import {
	splitNode as performSplit,
	bumpLeadingTrivia,
	mergeIntoPrevDeepLeaf,
	mergeWithNext as performMergeNext,
	deleteNode as performDelete,
	updateNodeContent as performUpdate,
	buildPastedReplacement,
	normalizeReplacementTrivia,
	ensureEditableContainers,
	reconcileTaskMetadata
} from '../tree-operations';
import { rebuildContainerRawIfContainer } from '../schema/container-raw';
import { isMergeEligible, isBlockEditable } from '../schema/merge-rules';
import { parseAllInlineContent } from '../core/inline';
import { displayLength, trimTrailingLineEnding } from '../core/lines';
import type { NestedActionsDeps } from './nested-actions';

export function createNestedBlockEdit(
	state: BlockListState,
	deps: NestedActionsDeps
): BlockEditActions {
	const { rebuildRaw, parent } = deps;

	const blockEdit: BlockEditActions = {
		// ── Structural mutations ───────────────────────────────────────────────
		async splitBlock(innerIndex: number, offset: number): Promise<void> {
			if (!deps.node.children) return;
			if (offset === 0 && displayLength(deps.node.children[innerIndex].raw) > 0) {
				// See block-edit.ts:splitBlock — performSplit at offset 0 of a
				// non-empty block would synthesize an empty leading paragraph
				// that desyncs from reparse.
				await parent.containerEdit.commitContainer({
					containerNode: deps.node,
					state,
					snapshot: { blockIndex: deps.index, offset: 0 },
					mutate: (children) => {
						const change = bumpLeadingTrivia({ children }, innerIndex);
						deps.node.children = children;
						rebuildRaw();
						return change;
					},
					op: { kind: 'split', detail: { at: 0 }, eventPath: [deps.index, innerIndex] },
					afterTick: () => {
						state.innerBlockRefs[innerIndex]?.focus(0);
					}
				});
				return;
			}
			await parent.containerEdit.commitContainer({
				containerNode: deps.node,
				state,
				snapshot: { blockIndex: deps.index, offset },
				mutate: (children) => {
					const change = performSplit({ children }, innerIndex, offset);
					// Sync before rebuildRaw — it reads deps.node.children directly.
					deps.node.children = children;
					rebuildRaw();
					return change;
				},
				op: { kind: 'split', eventPath: [deps.index, innerIndex] },
				afterTick: () => {
					state.innerBlockRefs[innerIndex + 1]?.focus(0);
				}
			});
		},

		async mergeWithPrevious(innerIndex: number): Promise<void> {
			if (!deps.node.children) return;

			// innerIndex === 0: delegate upward. Unwrap-style containers
			// (BlockquoteBlock U2, ListBlock U1/M1) override this whole method.
			// Await so caller continuations (focus placement) run after the
			// upward chain settles.
			if (innerIndex <= 0) {
				await parent.blockEdit.mergeWithPrevious(deps.index);
				return;
			}

			const prevKind = deps.node.children[innerIndex - 1].kind;
			const currKind = deps.node.children[innerIndex].kind;

			if (isMergeEligible(prevKind, currKind)) {
				let mergeResult: ReturnType<typeof mergeIntoPrevDeepLeaf> = null;
				await parent.containerEdit.commitContainer({
					containerNode: deps.node,
					state,
					snapshot: { blockIndex: deps.index, offset: 0 },
					mutate: (children) => {
						mergeResult = mergeIntoPrevDeepLeaf({ children }, innerIndex);
						// Sync before rebuildRaw — it reads deps.node.children directly.
						deps.node.children = children;
						rebuildRaw();
						return mergeResult?.change ?? { op: 'noop' };
					},
					op: {
						kind: 'merge',
						detail: { direction: 'prev' },
						eventPath: [deps.index, innerIndex]
					},
					afterTick: () => {
						if (!mergeResult) {
							state.innerBlockRefs[innerIndex - 1]?.focus(CURSOR_END);
							return;
						}
						const ref = state.innerBlockRefs[innerIndex - 1];
						if (mergeResult.targetPath.length === 0) {
							ref?.focus(mergeResult.joinOffset);
						} else {
							ref?.focusByPath?.(mergeResult.targetPath, mergeResult.joinOffset);
						}
					}
				});
			} else if (!isBlockEditable(prevKind)) {
				await parent.containerEdit.commitContainer({
					containerNode: deps.node,
					state,
					snapshot: { blockIndex: deps.index, offset: 0 },
					mutate: (children) => {
						const change = performDelete({ children }, innerIndex - 1);
						deps.node.children = children;
						rebuildRaw();
						return change;
					},
					op: { kind: 'delete', eventPath: [deps.index, innerIndex - 1] },
					afterTick: () => {
						state.innerBlockRefs[innerIndex - 1]?.focus(0);
					}
				});
			} else {
				state.innerBlockRefs[innerIndex - 1]?.focus(CURSOR_END);
			}
		},

		async mergeWithNext(innerIndex: number): Promise<void> {
			if (!deps.node.children) return;

			if (innerIndex >= deps.node.children.length - 1) {
				return parent.blockEdit.mergeWithNext(deps.index);
			}

			const currKind = deps.node.children[innerIndex].kind;
			const nextKind = deps.node.children[innerIndex + 1].kind;

			if (isMergeEligible(currKind, nextKind)) {
				const mergeOffset = displayLength(deps.node.children[innerIndex].raw);
				await parent.containerEdit.commitContainer({
					containerNode: deps.node,
					state,
					snapshot: { blockIndex: deps.index, offset: 0 },
					mutate: (children) => {
						const change = performMergeNext({ children }, innerIndex);
						deps.node.children = children;
						rebuildRaw();
						return change;
					},
					op: {
						kind: 'merge',
						detail: { direction: 'next' },
						eventPath: [deps.index, innerIndex]
					},
					afterTick: () => {
						state.innerBlockRefs[innerIndex]?.focus(mergeOffset);
					}
				});
			} else if (!isBlockEditable(nextKind)) {
				await parent.containerEdit.commitContainer({
					containerNode: deps.node,
					state,
					snapshot: { blockIndex: deps.index, offset: 0 },
					mutate: (children) => {
						const change = performDelete({ children }, innerIndex + 1);
						deps.node.children = children;
						rebuildRaw();
						return change;
					},
					op: { kind: 'delete', eventPath: [deps.index, innerIndex + 1] },
					afterTick: () => {
						state.innerBlockRefs[innerIndex]?.focus(CURSOR_END);
					}
				});
			} else {
				state.innerBlockRefs[innerIndex + 1]?.focus(0);
			}
		},

		async deleteBlock(innerIndex: number): Promise<void> {
			if (!deps.node.children) return;

			if (deps.node.children.length <= 1) {
				return parent.blockEdit.deleteBlock(deps.index);
			}

			await parent.containerEdit.commitContainer({
				containerNode: deps.node,
				state,
				snapshot: { blockIndex: deps.index, offset: 0 },
				mutate: (children) => {
					const change = performDelete({ children }, innerIndex);
					deps.node.children = children;
					rebuildRaw();
					return change;
				},
				op: { kind: 'delete', eventPath: [deps.index, innerIndex] },
				afterTick: () => {
					const focusIdx = Math.min(innerIndex, (deps.node.children?.length ?? 1) - 1);
					state.innerBlockRefs[focusIdx]?.focus(0);
				}
			});
		},

		// ── In-place leaf edits ────────────────────────────────────────────────
		async updateBlockContent(
			innerIndex: number,
			text: string,
			preEditOffset?: number,
			postEditFocusOffset?: number
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
				const focusOffset = postEditFocusOffset ?? preEditOffset ?? 0;
				await parent.containerEdit.commitContainer({
					containerNode: deps.node,
					state,
					snapshot: { blockIndex: deps.index, offset: preEditOffset ?? 0 },
					mutate: (children) => {
						performUpdate({ children }, innerIndex, text);
						deps.node.children = children;
						rebuildRaw();
						return { op: 'noop' };
					},
					op: {
						kind: 'updateContent',
						detail: { length: text.length },
						eventPath: [deps.index, innerIndex]
					},
					afterTick: () => {
						state.innerBlockRefs[innerIndex]?.focus(focusOffset);
					}
				});
				return;
			}

			// Routine typing — debounced undo path, no structural commit. Pass
			// the inner leaf's id as the batch key so focus moves between
			// sibling leaves inside this container break the typing batch.
			parent.containerEdit.pushDebouncedCheckpoint(
				deps.index,
				preEditOffset ?? 0,
				state.innerBlockIds[innerIndex]
			);
			performUpdate({ children: deps.node.children }, innerIndex, text);
			// listItem's taskItem metadata is extracted at parse time from the
			// first stripped line; live typing into the inner paragraph would
			// otherwise leave metadata frozen while serialized source drifts.
			if (deps.node.kind === 'listItem' && innerIndex === 0) {
				reconcileTaskMetadata(deps.node);
			}
			rebuildRaw();
			parent.containerEdit.nudgeReactivity();
		},

		async updateBlockMetadata(
			innerIndex: number,
			metadata: Record<string, unknown>,
			options?: { skipSnapshot?: boolean }
		): Promise<void> {
			if (!deps.node.children || innerIndex < 0 || innerIndex >= deps.node.children.length) return;
			const fields = Object.keys(metadata);
			if (fields.length === 0) return;

			await parent.containerEdit.commitContainer({
				containerNode: deps.node,
				state,
				snapshot: options?.skipSnapshot ? 'skip' : { blockIndex: deps.index, offset: 0 },
				mutate: () => {
					const node = deps.node.children![innerIndex];
					node.metadata = { ...(node.metadata ?? {}), ...metadata } as typeof node.metadata;
					// Metadata feeds raw for list items (taskMarker) — resync child
					// then container so serialize/reconciliation sees the new source.
					rebuildContainerRawIfContainer(node);
					rebuildRaw();
					return { op: 'noop' };
				},
				op: {
					kind: 'metadataUpdate',
					detail: { fields },
					eventPath: [deps.index, innerIndex]
				}
			});
		},

		// ── Composition ────────────────────────────────────────────────────────
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

			await parent.containerEdit.commitContainer({
				containerNode: deps.node,
				state,
				snapshot,
				mutate: (children) => {
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
					for (const node of normalizedReplacement) ensureEditableContainers(node);
					parseAllInlineContent(normalizedReplacement);
					children.splice(innerIndex, 1, ...normalizedReplacement);
					deps.node.children = children;
					rebuildRaw();
					// First replacement inherits the original block's id + ref;
					// matches top-level replaceBlock contract so Svelte's keyed
					// {#each} doesn't remount the leaf and lose IME state.
					return {
						op: 'replace',
						at: innerIndex,
						count: 1,
						newCount: normalizedReplacement.length,
						idMap: { 0: 0 }
					};
				},
				op: {
					kind: replacement.length === 0 ? 'delete' : 'replaceBlock',
					eventPath: [deps.index, innerIndex]
				},
				afterTick: () => {
					if (focus && replacement.length > 0) {
						const targetIdx = innerIndex + focus.replacementIndex;
						state.innerBlockRefs[targetIdx]?.focus(focus.offset);
					}
				}
			});
		}
	};

	return blockEdit;
}
