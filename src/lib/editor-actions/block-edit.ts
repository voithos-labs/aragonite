/**
 * Top-level BlockEditActions factory. Structural split/merge/delete/replace/
 * metadata route through the shared `block-edit-core` against a top-level
 * `CommitScope`; this factory adds the edge guards (sticky-column reset,
 * first/last-block bounds) and keeps the two per-level bodies the core can't
 * share: `insertParsedBlocks` (top-level emits a `paste` op, the container
 * routes through `replaceBlock` — G2.9 dual-emit) and `updateBlockContent`.
 */

import type { BlockEditActions, UndoEntryMode } from '../action-contracts';
import { CURSOR_END } from '../block-component';
import type { CstNode } from '../core/nodes';
import {
	updateNodeContent as performUpdate,
	ensureUnsharedPath,
	foldPasteReplacement
} from '../tree-operations';
import {
	replacePreservingFirst,
	stampStructuralChange
} from '../tree-operations/structural-change';
import type { EditorActionsDeps, UndoController } from './deps';
import { createTopLevelScope } from './block-edit-scope';
import { createBlockEditCore } from './block-edit-core';

export function createBlockEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): BlockEditActions {
	const scope = createTopLevelScope(deps, controller);
	const core = createBlockEditCore(scope);

	return {
		// ── Structural split / merge / delete (shared core) ───────────────────

		splitBlock: (blockIndex, offset) => core.split(blockIndex, offset),

		async mergeWithPrevious(blockIndex) {
			deps.stickyColumn.reset();
			if (blockIndex <= 0) return;
			await core.mergeWithPreviousInterior(blockIndex);
		},

		async mergeWithNext(blockIndex) {
			deps.stickyColumn.reset();
			if (blockIndex >= deps.doc.children.length - 1) return;
			await core.mergeWithNextInterior(blockIndex);
		},

		deleteBlock: (blockIndex) => core.deleteInterior(blockIndex),
		updateBlockMetadata: (blockIndex, metadata, options) =>
			core.updateBlockMetadata(blockIndex, metadata, options),
		replaceBlock: (blockIndex, replacement, focus, options) =>
			core.replaceBlock(blockIndex, replacement, focus, options),

		// ── Content update (per-level, unification deferred) ──────────────────

		async updateBlockContent(
			blockIndex: number,
			text: string,
			preEditOffset?: number,
			postEditFocusOffset?: number
		): Promise<void> {
			deps.stickyColumn.reset();
			controller.pushUndoSnapshotDebounced(blockIndex, preEditOffset ?? 0);
			// Out-of-ceremony in-place write: copy the node first when a snapshot
			// shares it (once per keystroke batch — the copy is owned afterwards).
			ensureUnsharedPath(deps.doc, [blockIndex], deps.sharing);
			const change = performUpdate(deps.doc, blockIndex, text);
			if (change.op !== 'noop') {
				const focusOffset = postEditFocusOffset ?? preEditOffset ?? 0;
				// performUpdate mutated the tree in place; commitStructural swaps the
				// children array atomically so Svelte remounts at the new kind.
				await controller.commitStructural({
					snapshot: 'skip',
					mutate: () => ({ op: 'noop' }),
					op: { kind: 'updateContent', detail: { length: text.length } },
					touchedNodes: [deps.doc.children[blockIndex]],
					afterTick: () => {
						deps.blockRefs[blockIndex]?.focus(focusOffset);
					}
				});
			}
			// Noop change (kind held): routine typing. The debounced snapshot above
			// holds the undo seam; `input` edit events fire at debounce-flush time.
		},

		// ── Paste (top-level emits `paste`; container routes via replaceBlock) ─

		async insertParsedBlocks(
			blockIndex: number,
			offset: number,
			blocks: CstNode[],
			preDelete?: { start: number; end: number },
			options?: { undoEntry?: UndoEntryMode }
		): Promise<void> {
			if (blocks.length === 0) return;

			// Build the replacement outside the commit so a failing fold can't
			// corrupt the document; the splice lives inside `mutate` so the
			// snapshot captures pre-paste state for one-step Ctrl+Z undo.
			const newNodes = foldPasteReplacement(
				deps.doc.children[blockIndex],
				offset,
				blocks,
				preDelete
			);
			const lastIndex = blockIndex + newNodes.length - 1;

			await scope.commit({
				snapshot: options?.undoEntry === 'join' ? 'skip' : { index: blockIndex, offset },
				eventTarget: blockIndex,
				op: { kind: 'paste', detail: { count: newNodes.length } },
				mutate: (view) => {
					view.children.splice(blockIndex, 1, ...newNodes);
					const change = replacePreservingFirst(blockIndex, 1, newNodes.length);
					stampStructuralChange(view.children, change, view.sharing);
					return change;
				},
				afterTick: () => {
					scope.refAt(lastIndex)?.focus(CURSOR_END);
				}
			});
		}
	};
}
