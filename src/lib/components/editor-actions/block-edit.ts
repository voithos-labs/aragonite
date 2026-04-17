/**
 * BlockEditActions factory: split, merge, delete, update, paste-insert,
 * and replace-with-blocks. Each method routes its mutation through
 * `controller.commitStructural` so the undo + reactivity ceremony stays
 * in one place.
 */

import { tick } from 'svelte';
import {
	CURSOR_END,
	type BlockEditActions,
	type BlockComponent,
	type CstNode
} from '../../contracts';
import { trimTrailingLineEnding, displayLength } from '../../core/lines';
import {
	splitNode as performSplit,
	mergeWithNext as performMergeNext,
	deleteNode as performDelete,
	updateNodeContent as performUpdate,
	ensureEditableContainers,
	rebuildAncestryRaw
} from '../../tree-operations';
import { generateBlockId } from '../../tree-operations/block-id';
import { isMergeEligible, isBlockEditable, findMergeTarget } from '../../tree-operations/merge-rules';
import { parse } from '../../core/parser';
import { parseInline, getContentRange, isProseKind } from '../../core/inline';
import type { EditorActionsDeps, UndoController } from './deps';

export function createBlockEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): BlockEditActions {
	return {
		async splitBlock(blockIndex: number, offset: number): Promise<void> {
			await controller.commitStructural(
				blockIndex,
				offset,
				(children, ids, refs) => {
					// Work on plain array copies to prevent $state proxy splice mutations
					// from triggering intermediate reactive updates that corrupt the keyed
					// {#each} component-to-index mapping.
					performSplit({ children }, ids, blockIndex, offset);
					// Sync blockRefs: insert undefined slot for the new block.
					// bind:ref in keyed {#each} only fires on mount, not when components
					// shift positions, so we must manually keep refs aligned.
					refs.splice(blockIndex + 1, 0, undefined);
				},
				() => deps.blockRefs[blockIndex + 1]?.focus(0)
			);
		},

		async mergeWithPrevious(blockIndex: number): Promise<void> {
			deps.stickyColumn.reset();
			if (blockIndex <= 0) return;

			const prev = deps.doc.children[blockIndex - 1];
			const curr = deps.doc.children[blockIndex];
			const prevKind = prev.kind;
			const currKind = curr.kind;

			if (!isMergeEligible(prevKind, currKind)) {
				if (!isBlockEditable(prevKind)) {
					// Previous block is non-editable — delete it
					await controller.commitStructural(
						blockIndex,
						0,
						(children, ids, refs) => {
							performDelete({ children }, ids, blockIndex - 1);
							refs.splice(blockIndex - 1, 1);
						},
						() => deps.blockRefs[blockIndex - 1]?.focus(0)
					);
				} else {
					// Previous block is editable but not mergeable — move focus
					deps.blockRefs[blockIndex - 1]?.focus(CURSOR_END);
				}
				return;
			}

			// Eligible — resolve the actual merge target. For prose/prose-absorber
			// prev this is prev itself (empty path). For container prev this is
			// the deepest prose leaf inside prev (non-empty path).
			const mergeTarget = findMergeTarget(prev);
			if (!mergeTarget) {
				// Walker couldn't find a prose leaf (e.g. container's deepest leaf
				// is opaque). Same fallback as ineligible — move focus.
				deps.blockRefs[blockIndex - 1]?.focus(CURSOR_END);
				return;
			}

			// Pre-compute join values before mutating (snapshot in commitStructural
			// must capture the pre-mutation state, so all mutation goes inside mutate).
			const target = mergeTarget.target;
			const targetRaw = target.raw ?? '';
			const currRaw = curr.raw ?? '';
			// Preserve the target's existing line ending style.
			const lineEnding = targetRaw.endsWith('\r\n') ? '\r\n' : '\n';
			const targetText = trimTrailingLineEnding(targetRaw);
			const currText = trimTrailingLineEnding(currRaw);
			const joinOffset = targetText.length;
			const mergedRaw = targetText + currText + lineEnding;

			// Delete curr from top-level children / ids / refs.
			// All mutations (target.raw, inline reparse, ancestry rebuild, array splice)
			// happen inside mutate so commitStructural snapshots the pre-mutation state.
			await controller.commitStructural(
				blockIndex,
				0,
				(children, ids, refs) => {
					// Mutate the target's raw. target is a reference into the same object
					// tree that childrenCopy shares (shallow copy), so this is safe.
					target.raw = mergedRaw;

					// Refresh the target's inline content cache. The per-input reactive
					// pipeline doesn't fire here because the user was typing in curr, not
					// in target — we must re-parse explicitly.
					if (isProseKind(target.kind)) {
						const range = getContentRange(target);
						target.inlineContent = parseInline(target.raw, range.start, range.end);
					}

					// Rebuild ancestry raw for container-target merges. For top-level prose
					// merges (empty path) there's no ancestry to rebuild — the target IS prev.
					if (mergeTarget.path.length > 0) {
						rebuildAncestryRaw(prev, mergeTarget.path);
					}

					performDelete({ children }, ids, blockIndex);
					refs.splice(blockIndex, 1);
				},
				() => {
					// Focus cascade: for flat (prev === target) merges, focus prev directly.
					// For nested-target merges, use focusByPath to cascade down.
					if (mergeTarget.path.length === 0) {
						deps.blockRefs[blockIndex - 1]?.focus(joinOffset);
					} else {
						deps.blockRefs[blockIndex - 1]?.focusByPath?.(mergeTarget.path, joinOffset);
					}
				}
			);
		},

		async mergeWithNext(blockIndex: number): Promise<void> {
			deps.stickyColumn.reset();
			if (blockIndex >= deps.doc.children.length - 1) return;

			const currKind = deps.doc.children[blockIndex].kind;
			const nextKind = deps.doc.children[blockIndex + 1].kind;

			if (!isMergeEligible(currKind, nextKind)) {
				if (!isBlockEditable(nextKind)) {
					// Next block is non-editable — delete it
					await controller.commitStructural(
						blockIndex,
						CURSOR_END,
						(children, ids, refs) => {
							performDelete({ children }, ids, blockIndex + 1);
							refs.splice(blockIndex + 1, 1);
						},
						() => deps.blockRefs[blockIndex]?.focus(CURSOR_END)
					);
				} else {
					// Next block is editable but not mergeable — move focus
					deps.blockRefs[blockIndex + 1]?.focus(0);
				}
				return;
			}

			// Mergeable — proceed with merge
			const mergeOffset = displayLength(deps.doc.children[blockIndex].raw);

			await controller.commitStructural(
				blockIndex,
				CURSOR_END,
				(children, ids, refs) => {
					performMergeNext({ children }, ids, blockIndex);
					refs.splice(blockIndex + 1, 1); // Remove next block's ref
				},
				() => deps.blockRefs[blockIndex]?.focus(mergeOffset)
			);
		},

		async deleteBlock(blockIndex: number): Promise<void> {
			await controller.commitStructural(
				blockIndex,
				0,
				(children, ids, refs) => {
					performDelete({ children }, ids, blockIndex);
					refs.splice(blockIndex, 1);
				},
				() => {
					// Focus the block that took the deleted block's position, or the previous one
					const focusIndex = Math.min(blockIndex, deps.doc.children.length - 1);
					if (focusIndex >= 0) {
						deps.blockRefs[focusIndex]?.focus(0);
					}
				}
			);
		},

		updateBlockContent(blockIndex: number, text: string, preEditOffset?: number): void {
			deps.stickyColumn.reset();
			controller.pushUndoSnapshotDebounced(blockIndex, preEditOffset ?? 0);
			const result = performUpdate(deps.doc, blockIndex, text);
			if (result.kindChanged) {
				deps.setDocChildren([...deps.doc.children]);
				// Re-focus after Svelte swaps the component type.
				// Use preEditOffset (the cursor position before the edit) to restore
				// the cursor approximately where it was.
				tick().then(() => {
					deps.blockRefs[blockIndex]?.focus(preEditOffset ?? 0);
				});
			}
		},

		async insertParsedBlocks(blockIndex: number, offset: number, blocks: CstNode[]): Promise<void> {
			if (blocks.length === 0) return;

			const currentNode = deps.doc.children[blockIndex];
			const rawText = currentNode.raw;
			const lineEnding = rawText.endsWith('\r\n') ? '\r\n' : '\n';

			// Split the current block's raw at offset into before/after
			const rawBefore = rawText.slice(0, offset);
			const rawAfter = trimTrailingLineEnding(rawText.slice(offset));

			const newNodes: CstNode[] = [];

			// If there's text before the cursor, it becomes the first block
			if (rawBefore.length > 0) {
				const beforeRaw = rawBefore + lineEnding;
				const beforeDoc = parse(beforeRaw);
				const beforeNode =
					beforeDoc.children.length > 0
						? beforeDoc.children[0]
						: { kind: 'paragraph' as const, leadingTrivia: '', raw: beforeRaw };
				beforeNode.leadingTrivia = currentNode.leadingTrivia;
				ensureEditableContainers(beforeNode);
				newNodes.push(beforeNode);
			}

			// Add all pasted blocks except the last
			for (let i = 0; i < blocks.length - 1; i++) {
				const node = { ...blocks[i] };
				if (newNodes.length === 0) {
					node.leadingTrivia = currentNode.leadingTrivia;
				}
				ensureEditableContainers(node);
				newNodes.push(node);
			}

			// Last pasted block gets rawAfter appended
			const lastPasted = blocks[blocks.length - 1];
			const mergedLastRaw = trimTrailingLineEnding(lastPasted.raw) + rawAfter + lineEnding;
			const lastDoc = parse(mergedLastRaw);
			const lastNode =
				lastDoc.children.length > 0
					? lastDoc.children[0]
					: { kind: 'paragraph' as const, leadingTrivia: '', raw: mergedLastRaw };
			if (newNodes.length === 0) {
				lastNode.leadingTrivia = currentNode.leadingTrivia;
			} else {
				lastNode.leadingTrivia = '';
			}
			ensureEditableContainers(lastNode);
			newNodes.push(lastNode);

			// Parse inline content for all new nodes
			deps.parseAllInlineContent(newNodes);

			const lastIndex = blockIndex + newNodes.length - 1;

			// Work on plain copies to prevent proxy splice cascades
			await controller.commitStructural(
				blockIndex,
				offset,
				(children, ids, refs) => {
					// Replace the original block with new nodes
					children.splice(blockIndex, 1, ...newNodes);

					// Update blockIds: keep original ID for first, generate new for the rest
					const newIds = newNodes.slice(1).map(() => generateBlockId());
					ids.splice(blockIndex + 1, 0, ...newIds);

					// Sync refs: replace one slot with N undefined slots
					const newRefSlots: (BlockComponent | undefined)[] = new Array(newNodes.length).fill(
						undefined
					);
					newRefSlots[0] = refs[blockIndex]; // keep existing ref for first node
					refs.splice(blockIndex, 1, ...newRefSlots);
				},
				() => {
					// Focus at end of last inserted node
					deps.blockRefs[lastIndex]?.focus(CURSOR_END);
				}
			);
		},

		async replaceBlock(
			blockIndex: number,
			replacement: CstNode[],
			focus?: { replacementIndex: number; offset: number }
		): Promise<void> {
			if (blockIndex < 0 || blockIndex >= deps.doc.children.length) return;

			// Preserve leading trivia of the original block on the first replacement.
			const originalTrivia = deps.doc.children[blockIndex].leadingTrivia;

			// Normalize replacement nodes before entering commitStructural so the
			// mutation callback only handles the array splice.
			const normalizedReplacement =
				replacement.length > 0
					? replacement.map((node, i) => {
							const copy = { ...node };
							copy.leadingTrivia = i === 0 ? originalTrivia : (copy.leadingTrivia ?? '');
							ensureEditableContainers(copy);
							return copy;
						})
					: [];

			// Parse inline content for any prose-kind replacement blocks.
			if (normalizedReplacement.length > 0) {
				deps.parseAllInlineContent(normalizedReplacement);
			}

			// Work on plain copies to prevent $state proxy splice cascades.
			await controller.commitStructural(
				blockIndex,
				focus?.offset ?? 0,
				(children, ids, refs) => {
					if (normalizedReplacement.length === 0) {
						// Degenerate case: delete the block.
						children.splice(blockIndex, 1);
						ids.splice(blockIndex, 1);
						refs.splice(blockIndex, 1);
					} else {
						children.splice(blockIndex, 1, ...normalizedReplacement);

						// IDs: fresh for each replacement block.
						const newIds = normalizedReplacement.map(() => generateBlockId());
						ids.splice(blockIndex, 1, ...newIds);

						// Refs: new undefined slots for each replacement block.
						const newRefSlots: (BlockComponent | undefined)[] = new Array(
							normalizedReplacement.length
						).fill(undefined);
						refs.splice(blockIndex, 1, ...newRefSlots);
					}
				},
				() => {
					if (focus && normalizedReplacement.length > 0) {
						const targetIndex = blockIndex + focus.replacementIndex;
						deps.blockRefs[targetIndex]?.focus(focus.offset);
					}
				}
			);
		}
	};
}
