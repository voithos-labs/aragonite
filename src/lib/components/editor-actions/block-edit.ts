/**
 * BlockEditActions factory. Each method routes its mutation through
 * `controller.commitStructural` so the undo + reactivity ceremony lives
 * in one place.
 */

import { CURSOR_END, type BlockEditActions, type CstNode } from '../../contracts';
import { trimTrailingLineEnding, displayLength } from '../../core/lines';
import {
	splitNode as performSplit,
	mergeWithNext as performMergeNext,
	deleteNode as performDelete,
	updateNodeContent as performUpdate,
	ensureEditableContainers,
	rebuildAncestryRaw,
	buildPastedReplacement,
	normalizeReplacementTrivia
} from '../../tree-operations';
import {
	isMergeEligible,
	isBlockEditable,
	findMergeTarget
} from '../../tree-operations/merge-rules';
import {
	parseInline,
	getContentRange,
	isProseKind,
	parseAllInlineContent
} from '../../core/inline';
import type { EditorActionsDeps, UndoController } from './deps';

export function createBlockEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): BlockEditActions {
	return {
		// ── Structural split / merge / delete ─────────────────────────────────

		async splitBlock(blockIndex: number, offset: number): Promise<void> {
			await controller.commitStructural(
				blockIndex,
				offset,
				(children) => performSplit({ children }, blockIndex, offset),
				() => deps.blockRefs[blockIndex + 1]?.focus(0),
				{ op: { kind: 'split', detail: { at: offset } } }
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
					await controller.commitStructural(
						blockIndex,
						0,
						(children) => performDelete({ children }, blockIndex - 1),
						() => deps.blockRefs[blockIndex - 1]?.focus(0),
						{ op: { kind: 'delete' } }
					);
				} else {
					deps.blockRefs[blockIndex - 1]?.focus(CURSOR_END);
				}
				return;
			}

			// For prose/prose-absorber prev, target is prev itself (empty path).
			// For container prev, target is the deepest prose leaf.
			const mergeTarget = findMergeTarget(prev);
			if (!mergeTarget) {
				deps.blockRefs[blockIndex - 1]?.focus(CURSOR_END);
				return;
			}

			// Pre-compute join values before mutating — commitStructural's snapshot
			// captures pre-mutation state, so all mutation must live inside mutate.
			const target = mergeTarget.target;
			const targetRaw = target.raw ?? '';
			const currRaw = curr.raw ?? '';
			const lineEnding = targetRaw.endsWith('\r\n') ? '\r\n' : '\n';
			const targetText = trimTrailingLineEnding(targetRaw);
			const currText = trimTrailingLineEnding(currRaw);
			const joinOffset = targetText.length;
			const mergedRaw = targetText + currText + lineEnding;

			await controller.commitStructural(
				blockIndex,
				0,
				(children) => {
					// `target` references into the shallow-copied tree shared with
					// childrenCopy, so this write reaches the committed children.
					target.raw = mergedRaw;

					// Refresh the target's inline cache: the reactive pipeline didn't
					// fire because the user typed in curr, not target.
					if (isProseKind(target.kind)) {
						const range = getContentRange(target);
						target.inlineContent = parseInline(target.raw, range.start, range.end);
					}

					if (mergeTarget.path.length > 0) {
						rebuildAncestryRaw(prev, mergeTarget.path);
					}

					return performDelete({ children }, blockIndex);
				},
				() => {
					if (mergeTarget.path.length === 0) {
						deps.blockRefs[blockIndex - 1]?.focus(joinOffset);
					} else {
						deps.blockRefs[blockIndex - 1]?.focusByPath?.(mergeTarget.path, joinOffset);
					}
				},
				{ op: { kind: 'merge', detail: { direction: 'prev' } } }
			);
		},

		async mergeWithNext(blockIndex: number): Promise<void> {
			deps.stickyColumn.reset();
			if (blockIndex >= deps.doc.children.length - 1) return;

			const currKind = deps.doc.children[blockIndex].kind;
			const nextKind = deps.doc.children[blockIndex + 1].kind;

			if (!isMergeEligible(currKind, nextKind)) {
				if (!isBlockEditable(nextKind)) {
					await controller.commitStructural(
						blockIndex,
						CURSOR_END,
						(children) => performDelete({ children }, blockIndex + 1),
						() => deps.blockRefs[blockIndex]?.focus(CURSOR_END),
						{ op: { kind: 'delete' } }
					);
				} else {
					deps.blockRefs[blockIndex + 1]?.focus(0);
				}
				return;
			}

			const mergeOffset = displayLength(deps.doc.children[blockIndex].raw);

			await controller.commitStructural(
				blockIndex,
				CURSOR_END,
				(children) => performMergeNext({ children }, blockIndex),
				() => deps.blockRefs[blockIndex]?.focus(mergeOffset),
				{ op: { kind: 'merge', detail: { direction: 'next' } } }
			);
		},

		async deleteBlock(blockIndex: number): Promise<void> {
			await controller.commitStructural(
				blockIndex,
				0,
				(children) => performDelete({ children }, blockIndex),
				() => {
					const focusIndex = Math.min(blockIndex, deps.doc.children.length - 1);
					if (focusIndex >= 0) {
						deps.blockRefs[focusIndex]?.focus(0);
					}
				},
				{ op: { kind: 'delete' } }
			);
		},

		// ── Content update ────────────────────────────────────────────────────

		async updateBlockContent(
			blockIndex: number,
			text: string,
			preEditOffset?: number
		): Promise<void> {
			deps.stickyColumn.reset();
			controller.pushUndoSnapshotDebounced(blockIndex, preEditOffset ?? 0);
			const result = performUpdate(deps.doc, blockIndex, text);
			if (result.kindChanged) {
				// Structural republish sharing the debounced snapshot via skipSnapshot.
				// performUpdate already mutated the tree in place; commitStructural
				// swaps the children array atomically so Svelte remounts at the new kind.
				await controller.commitStructural(
					blockIndex,
					preEditOffset ?? 0,
					() => ({ op: 'noop' }),
					() => {
						deps.blockRefs[blockIndex]?.focus(preEditOffset ?? 0);
					},
					{ skipSnapshot: true, op: { kind: 'updateContent', detail: { length: text.length } } }
				);
			}
			// Non-kindChanged: routine typing. The debounced snapshot above holds
			// the undo seam; `input` edit events fire at debounce-flush time.
		},

		async updateBlockMetadata(
			blockIndex: number,
			metadata: Record<string, unknown>,
			options?: { skipSnapshot?: boolean }
		): Promise<void> {
			if (blockIndex < 0 || blockIndex >= deps.doc.children.length) return;
			const fields = Object.keys(metadata);
			if (fields.length === 0) return;

			await controller.commitStructural(
				blockIndex,
				0,
				() => {
					const node = deps.doc.children[blockIndex];
					node.metadata = { ...(node.metadata ?? {}), ...metadata } as typeof node.metadata;
					return { op: 'noop' };
				},
				undefined,
				{
					...options,
					op: { kind: 'metadataUpdate', detail: { fields } }
				}
			);
		},

		// ── Paste / replace ───────────────────────────────────────────────────

		async insertParsedBlocks(
			blockIndex: number,
			offset: number,
			blocks: CstNode[],
			preDelete?: { start: number; end: number },
			options?: { skipSnapshot?: boolean }
		): Promise<void> {
			if (blocks.length === 0) return;

			const currentNode = deps.doc.children[blockIndex];

			// Compute replacement outside commitStructural against the post-preDelete
			// raw — a failing buildPastedReplacement won't corrupt the document. Raw
			// mutation lives inside `mutate` so the snapshot captures pre-paste state,
			// giving Ctrl+Z one-step undo for the whole paste.
			let effectiveRaw = currentNode.raw;
			let effectiveOffset = offset;
			if (preDelete && preDelete.start < preDelete.end) {
				const display = trimTrailingLineEnding(currentNode.raw);
				const lineEnd = currentNode.raw.endsWith('\r\n') ? '\r\n' : '\n';
				effectiveRaw = display.slice(0, preDelete.start) + display.slice(preDelete.end) + lineEnd;
				effectiveOffset = preDelete.start;
			}
			const synthLeaf: CstNode = { ...currentNode, raw: effectiveRaw };
			const newNodes = buildPastedReplacement(synthLeaf, effectiveOffset, blocks);
			const lastIndex = blockIndex + newNodes.length - 1;

			await controller.commitStructural(
				blockIndex,
				offset,
				(children) => {
					children.splice(blockIndex, 1, ...newNodes);
					// First replacement inherits the original block's id + ref.
					return {
						op: 'replace',
						at: blockIndex,
						count: 1,
						newCount: newNodes.length,
						idMap: { 0: 0 }
					};
				},
				() => {
					deps.blockRefs[lastIndex]?.focus(CURSOR_END);
				},
				{ ...options, op: { kind: 'paste', detail: { count: newNodes.length } } }
			);
		},

		async replaceBlock(
			blockIndex: number,
			replacement: CstNode[],
			focus?: { replacementIndex: number; offset: number },
			options?: { skipSnapshot?: boolean }
		): Promise<void> {
			if (blockIndex < 0 || blockIndex >= deps.doc.children.length) return;

			const normalizedReplacement =
				replacement.length > 0
					? normalizeReplacementTrivia(deps.doc.children[blockIndex], replacement)
					: [];
			for (const node of normalizedReplacement) ensureEditableContainers(node);
			if (normalizedReplacement.length > 0) {
				parseAllInlineContent(normalizedReplacement);
			}

			await controller.commitStructural(
				blockIndex,
				focus?.offset ?? 0,
				(children) => {
					if (normalizedReplacement.length === 0) {
						children.splice(blockIndex, 1);
						return { op: 'delete', at: blockIndex, count: 1 };
					}
					children.splice(blockIndex, 1, ...normalizedReplacement);
					return {
						op: 'replace',
						at: blockIndex,
						count: 1,
						newCount: normalizedReplacement.length
					};
				},
				() => {
					if (focus && normalizedReplacement.length > 0) {
						const targetIndex = blockIndex + focus.replacementIndex;
						deps.blockRefs[targetIndex]?.focus(focus.offset);
					}
				},
				{
					...options,
					op: { kind: 'replaceBlock', detail: { count: normalizedReplacement.length } }
				}
			);
		}
	};
}
