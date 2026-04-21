/**
 * BlockEditActions factory: split, merge, delete, update, paste-insert,
 * and replace-with-blocks. Each method routes its mutation through
 * `controller.commitStructural` so the undo + reactivity ceremony stays
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
					// Previous block is non-editable — delete it
					await controller.commitStructural(
						blockIndex,
						0,
						(children) => performDelete({ children }, blockIndex - 1),
						() => deps.blockRefs[blockIndex - 1]?.focus(0),
						{ op: { kind: 'delete' } }
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

			// Delete curr from top-level children. All mutations (target.raw,
			// inline reparse, ancestry rebuild, array splice) happen inside
			// mutate so commitStructural snapshots the pre-mutation state.
			await controller.commitStructural(
				blockIndex,
				0,
				(children) => {
					// Mutate the target's raw. target is a reference into the same
					// object tree that childrenCopy shares (shallow copy), so this is safe.
					target.raw = mergedRaw;

					// Refresh the target's inline content cache. The per-input reactive
					// pipeline doesn't fire here because the user was typing in curr, not
					// in target — we must re-parse explicitly.
					if (isProseKind(target.kind)) {
						const range = getContentRange(target);
						target.inlineContent = parseInline(target.raw, range.start, range.end);
					}

					// Rebuild ancestry raw for container-target merges. For top-level
					// prose merges (empty path) there's no ancestry to rebuild.
					if (mergeTarget.path.length > 0) {
						rebuildAncestryRaw(prev, mergeTarget.path);
					}

					return performDelete({ children }, blockIndex);
				},
				() => {
					// Focus cascade: for flat (prev === target) merges, focus prev directly.
					// For nested-target merges, use focusByPath to cascade down.
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
					// Next block is non-editable — delete it
					await controller.commitStructural(
						blockIndex,
						CURSOR_END,
						(children) => performDelete({ children }, blockIndex + 1),
						() => deps.blockRefs[blockIndex]?.focus(CURSOR_END),
						{ op: { kind: 'delete' } }
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
				// Kind change is a structural republish, not a new undo entry:
				// the debounced snapshot above already captured the pre-edit state,
				// so this commit shares that entry via skipSnapshot. The mutate
				// callback returns noop — performUpdate mutated the tree in place,
				// and commitStructural will swap the children array atomically so
				// Svelte remounts with the correct block kind.
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
			// Non-kindChanged branch is routine typing. The debounced snapshot
			// above holds the undo seam; `input` edit events at debounce-flush
			// time feed the op-log via its `events.on('edit', ...)` subscription.
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

			// Compute replacement once, outside commitStructural, based on the
			// post-preDelete raw so a failing `buildPastedReplacement` doesn't
			// corrupt the document. The actual raw mutation happens inside
			// `mutate` below so the snapshot captured by commitStructural holds
			// the pre-paste state, giving Ctrl+Z one-step undo for the entire
			// paste (selection-delete + splice in one entry).
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
					return {
						op: 'replace',
						at: blockIndex,
						count: 1,
						newCount: newNodes.length,
						idMap: { 0: 0 } // first replacement inherits the original block's id + ref
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

			// Normalize trivia + ensure editable containers + reparse inline, then
			// the mutation callback only splices. Shared with nested replaceBlock
			// and ListBlock's replaceBlock override via normalizeReplacementTrivia.
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
						// no idMap — every replacement gets a fresh id (existing behavior)
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
