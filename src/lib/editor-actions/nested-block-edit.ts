/**
 * BlockEditActions factory for container nestedActions bundles. Each method
 * routes mutations through `parent.containerEdit.commitContainer` so the
 * snapshot, op-event, spine unshare, and reactivity ceremony lives in one
 * place. Mutate callbacks operate on the OWNED scope the ceremony provides;
 * pre-existing children an op writes are unshared first, created children
 * are stamped.
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
	ensureUnsharedChild,
	rebuildOwnedContainer,
	reconcileTaskMetadata,
	stampStructuralChange,
	type StructuralChange
} from '../tree-operations';
import { isMergeEligible, isBlockEditable } from '../schema/merge-rules';
import { assertInvariant } from '../invariants/assert';
import { displayLength, trimTrailingLineEnding } from '../core/lines';
import type { NestedActionsDeps } from './nested-actions';

export function createNestedBlockEdit(
	state: BlockListState,
	deps: NestedActionsDeps
): BlockEditActions {
	const { parent } = deps;

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
					path: deps.path,
					state,
					snapshot: { blockIndex: deps.index, offset: 0 },
					mutate: (scope) => {
						ensureUnsharedChild(scope.node, innerIndex, scope.sharing);
						return bumpLeadingTrivia({ children: scope.children }, innerIndex);
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
				path: deps.path,
				state,
				snapshot: { blockIndex: deps.index, offset },
				mutate: (scope) => {
					const change = performSplit({ children: scope.children }, innerIndex, offset);
					stampStructuralChange(scope.children, change, scope.sharing);
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
					path: deps.path,
					state,
					snapshot: { blockIndex: deps.index, offset: 0 },
					mutate: (scope) => {
						mergeResult = mergeIntoPrevDeepLeaf(
							{ children: scope.children },
							innerIndex,
							scope.sharing
						);
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
					path: deps.path,
					state,
					snapshot: { blockIndex: deps.index, offset: 0 },
					mutate: (scope) =>
						performDelete({ children: scope.children }, innerIndex - 1, scope.sharing),
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
					path: deps.path,
					state,
					snapshot: { blockIndex: deps.index, offset: 0 },
					mutate: (scope) => {
						const change = performMergeNext({ children: scope.children }, innerIndex);
						stampStructuralChange(scope.children, change, scope.sharing);
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
					path: deps.path,
					state,
					snapshot: { blockIndex: deps.index, offset: 0 },
					mutate: (scope) =>
						performDelete({ children: scope.children }, innerIndex + 1, scope.sharing),
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
				path: deps.path,
				state,
				snapshot: { blockIndex: deps.index, offset: 0 },
				mutate: (scope) => performDelete({ children: scope.children }, innerIndex, scope.sharing),
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
					path: deps.path,
					state,
					snapshot: { blockIndex: deps.index, offset: preEditOffset ?? 0 },
					mutate: (scope) => {
						ensureUnsharedChild(scope.node, innerIndex, scope.sharing);
						performUpdate({ children: scope.children }, innerIndex, text);
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
			const leafPath = [...deps.path, innerIndex];
			parent.containerEdit.withUnsharedSpine(leafPath, (chain) => {
				assertInvariant('unshared-spine-depth', () =>
					chain.length === leafPath.length
						? null
						: {
								code: 'unshared-spine-depth',
								message: `withUnsharedSpine: chain depth ${chain.length} != leaf path depth ${leafPath.length}`
							}
				);
				const ownedContainer = chain[leafPath.length - 2];
				if (!ownedContainer?.children) return;
				performUpdate({ children: ownedContainer.children }, innerIndex, text);
				// listItem's taskItem metadata is extracted at parse time from the
				// first stripped line; live typing into the inner paragraph would
				// otherwise leave metadata frozen while serialized source drifts.
				if (ownedContainer.kind === 'listItem' && innerIndex === 0) {
					reconcileTaskMetadata(ownedContainer);
				}
			});
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
				path: deps.path,
				state,
				snapshot: options?.skipSnapshot ? 'skip' : { blockIndex: deps.index, offset: 0 },
				mutate: (scope) => {
					const node = ensureUnsharedChild(scope.node, innerIndex, scope.sharing);
					node.metadata = { ...(node.metadata ?? {}), ...metadata } as typeof node.metadata;
					// Metadata feeds raw for list items (taskMarker) — resync the
					// child so the ceremony's ancestry rebuild concatenates fresh raw.
					rebuildOwnedContainer(node, scope.sharing);
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
				path: deps.path,
				state,
				snapshot,
				mutate: (scope) => {
					if (replacement.length === 0) {
						scope.children.splice(innerIndex, 1);
						return { op: 'delete', at: innerIndex, count: 1 };
					}
					const normalizedReplacement = normalizeReplacementTrivia(
						scope.children[innerIndex],
						replacement
					);
					for (const node of normalizedReplacement) ensureEditableContainers(node);
					scope.children.splice(innerIndex, 1, ...normalizedReplacement);
					// First replacement inherits the original block's id + ref;
					// matches top-level replaceBlock contract so Svelte's keyed
					// {#each} doesn't remount the leaf and lose IME state.
					const change: StructuralChange = {
						op: 'replace',
						at: innerIndex,
						count: 1,
						newCount: normalizedReplacement.length,
						idMap: { 0: 0 }
					};
					stampStructuralChange(scope.children, change, scope.sharing);
					return change;
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
