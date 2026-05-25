/**
 * BlockEditActions factory. Each method routes its mutation through
 * `controller.commitStructural` so the undo + reactivity ceremony lives
 * in one place.
 */

import type { BlockEditActions } from '../action-contracts';
import { CURSOR_END } from '../block-component';
import type { CstNode } from '../core/nodes';
import { trimTrailingLineEnding, displayLength } from '../core/lines';
import {
	splitNode as performSplit,
	bumpLeadingTrivia,
	mergeWithNext as performMergeNext,
	mergeIntoPrevDeepLeaf,
	deleteNode as performDelete,
	updateNodeContent as performUpdate,
	ensureEditableContainers,
	buildPastedReplacement,
	normalizeReplacementTrivia
} from '../tree-operations';
import { rebuildContainerRawIfContainer } from '../schema/container-raw';
import { isMergeEligible, isBlockEditable } from '../schema/merge-rules';
import { parseAllInlineContent } from '../core/inline';
import type { EditorActionsDeps, UndoController } from './deps';

export function createBlockEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): BlockEditActions {
	return {
		// ── Structural split / merge / delete ─────────────────────────────────

		async splitBlock(blockIndex: number, offset: number): Promise<void> {
			if (offset === 0 && displayLength(deps.doc.children[blockIndex].raw) > 0) {
				// performSplit at offset 0 of a non-empty block would synthesize
				// an empty leading paragraph whose '\n' raw collapses into trivia
				// on reparse — the live tree desyncs from serialize(parse(source)).
				// Bump the block's own leadingTrivia instead so the round-trip
				// holds. (Empty blocks fall through: their splitNode result is
				// [empty, empty], which is the intended rapid-Enter behavior.)
				await controller.commitStructural({
					snapshot: { blockIndex, offset: 0 },
					mutate: (children) => bumpLeadingTrivia({ children }, blockIndex),
					op: { kind: 'split', detail: { at: 0 } },
					afterTick: () => deps.blockRefs[blockIndex]?.focus(0)
				});
				return;
			}
			await controller.commitStructural({
				snapshot: { blockIndex, offset },
				mutate: (children) => performSplit({ children }, blockIndex, offset),
				op: { kind: 'split', detail: { at: offset } },
				afterTick: () => deps.blockRefs[blockIndex + 1]?.focus(0)
			});
		},

		async mergeWithPrevious(blockIndex: number): Promise<void> {
			deps.stickyColumn.reset();
			if (blockIndex <= 0) return;

			const prevKind = deps.doc.children[blockIndex - 1].kind;
			const currKind = deps.doc.children[blockIndex].kind;

			if (!isMergeEligible(prevKind, currKind)) {
				if (!isBlockEditable(prevKind)) {
					await controller.commitStructural({
						snapshot: { blockIndex, offset: 0 },
						mutate: (children) => performDelete({ children }, blockIndex - 1),
						op: { kind: 'delete' },
						afterTick: () => deps.blockRefs[blockIndex - 1]?.focus(0)
					});
				} else {
					deps.blockRefs[blockIndex - 1]?.focus(CURSOR_END);
				}
				return;
			}

			let mergeResult: ReturnType<typeof mergeIntoPrevDeepLeaf> = null;
			await controller.commitStructural({
				snapshot: { blockIndex, offset: 0 },
				mutate: (children) => {
					mergeResult = mergeIntoPrevDeepLeaf({ children }, blockIndex);
					return mergeResult?.change ?? { op: 'noop' };
				},
				op: { kind: 'merge', detail: { direction: 'prev' } },
				afterTick: () => {
					if (!mergeResult) {
						deps.blockRefs[blockIndex - 1]?.focus(CURSOR_END);
						return;
					}
					const ref = deps.blockRefs[blockIndex - 1];
					if (mergeResult.targetPath.length === 0) {
						ref?.focus(mergeResult.joinOffset);
					} else {
						ref?.focusByPath?.(mergeResult.targetPath, mergeResult.joinOffset);
					}
				}
			});
		},

		async mergeWithNext(blockIndex: number): Promise<void> {
			deps.stickyColumn.reset();
			if (blockIndex >= deps.doc.children.length - 1) return;

			const currKind = deps.doc.children[blockIndex].kind;
			const nextKind = deps.doc.children[blockIndex + 1].kind;

			if (!isMergeEligible(currKind, nextKind)) {
				if (!isBlockEditable(nextKind)) {
					await controller.commitStructural({
						snapshot: { blockIndex, offset: CURSOR_END },
						mutate: (children) => performDelete({ children }, blockIndex + 1),
						op: { kind: 'delete' },
						afterTick: () => deps.blockRefs[blockIndex]?.focus(CURSOR_END)
					});
				} else {
					deps.blockRefs[blockIndex + 1]?.focus(0);
				}
				return;
			}

			const mergeOffset = displayLength(deps.doc.children[blockIndex].raw);

			await controller.commitStructural({
				snapshot: { blockIndex, offset: CURSOR_END },
				mutate: (children) => performMergeNext({ children }, blockIndex),
				op: { kind: 'merge', detail: { direction: 'next' } },
				afterTick: () => deps.blockRefs[blockIndex]?.focus(mergeOffset)
			});
		},

		async deleteBlock(blockIndex: number): Promise<void> {
			await controller.commitStructural({
				snapshot: { blockIndex, offset: 0 },
				mutate: (children) => performDelete({ children }, blockIndex),
				op: { kind: 'delete' },
				afterTick: () => {
					const focusIndex = Math.min(blockIndex, deps.doc.children.length - 1);
					if (focusIndex >= 0) {
						deps.blockRefs[focusIndex]?.focus(0);
					}
				}
			});
		},

		// ── Content update ────────────────────────────────────────────────────

		async updateBlockContent(
			blockIndex: number,
			text: string,
			preEditOffset?: number,
			postEditFocusOffset?: number
		): Promise<void> {
			deps.stickyColumn.reset();
			controller.pushUndoSnapshotDebounced(blockIndex, preEditOffset ?? 0);
			const result = performUpdate(deps.doc, blockIndex, text);
			if (result.kindChanged) {
				const focusOffset = postEditFocusOffset ?? preEditOffset ?? 0;
				// performUpdate mutated the tree in place; commitStructural swaps the
				// children array atomically so Svelte remounts at the new kind.
				await controller.commitStructural({
					snapshot: 'skip',
					mutate: () => ({ op: 'noop' }),
					op: { kind: 'updateContent', detail: { length: text.length } },
					afterTick: () => {
						deps.blockRefs[blockIndex]?.focus(focusOffset);
					}
				});
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

			const snapshot = options?.skipSnapshot ? ('skip' as const) : { blockIndex, offset: 0 };

			await controller.commitStructural({
				snapshot,
				mutate: () => {
					const node = deps.doc.children[blockIndex];
					node.metadata = { ...(node.metadata ?? {}), ...metadata } as typeof node.metadata;
					// Metadata feeds raw for list items (taskMarker) — resync so
					// serialize/reconciliation sees the new source.
					rebuildContainerRawIfContainer(node);
					return { op: 'noop' };
				},
				op: { kind: 'metadataUpdate', detail: { fields } }
			});
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

			const snapshot = options?.skipSnapshot ? ('skip' as const) : { blockIndex, offset };

			await controller.commitStructural({
				snapshot,
				mutate: (children) => {
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
				op: { kind: 'paste', detail: { count: newNodes.length } },
				afterTick: () => {
					deps.blockRefs[lastIndex]?.focus(CURSOR_END);
				}
			});
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

			const snapshot = options?.skipSnapshot
				? ('skip' as const)
				: { blockIndex, offset: focus?.offset ?? 0 };

			await controller.commitStructural({
				snapshot,
				mutate: (children) => {
					if (normalizedReplacement.length === 0) {
						children.splice(blockIndex, 1);
						return { op: 'delete', at: blockIndex, count: 1 };
					}
					children.splice(blockIndex, 1, ...normalizedReplacement);
					// First replacement inherits the original block's id + ref so
					// Svelte's keyed {#each} doesn't destroy+recreate the component
					// — preserves IME composition state and pending input.
					return {
						op: 'replace',
						at: blockIndex,
						count: 1,
						newCount: normalizedReplacement.length,
						idMap: { 0: 0 }
					};
				},
				op: { kind: 'replaceBlock', detail: { count: normalizedReplacement.length } },
				afterTick: () => {
					if (focus && normalizedReplacement.length > 0) {
						const targetIndex = blockIndex + focus.replacementIndex;
						deps.blockRefs[targetIndex]?.focus(focus.offset);
					}
				}
			});
		}
	};
}
