/**
 * Top-level BlockEditActions factory. Structural split/merge/delete/replace/
 * metadata route through the shared `block-edit-core` against a top-level
 * `CommitScope`; this factory adds the edge guards (sticky-column reset,
 * first/last-block bounds) and keeps the one per-level body the core can't
 * share: `updateBlockContent`.
 */

import type { BlockEditActions } from '../action-contracts';
import { updateNodeContent as performUpdate, ensureUnsharedPath } from '../tree-operations';
import { stampStructuralChange, type StructuralChange } from '../tree-operations/structural-change';
import type { EditorActionsDeps, UndoController } from './deps';
import { createTopLevelScope } from './block-edit-scope';
import { createBlockEditCore } from './block-edit-core';
import { previewContentReparse, focusAfterContentReplace } from './replacement-focus';

export function createBlockEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): BlockEditActions {
	const scope = createTopLevelScope(deps, controller);
	const core = createBlockEditCore(scope);

	return {
		// ── Structural split / merge / delete (shared core) ───────────────────

		splitBlock: (blockIndex, offset) => core.split(blockIndex, offset),
		descendToBody: (blockIndex) => core.descendToBody(blockIndex),

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

		// ── Content update (per-level) ────────────────────────────────────────

		async updateBlockContent(
			blockIndex: number,
			text: string,
			preEditOffset?: number,
			postEditFocusOffset?: number
		): Promise<void> {
			deps.stickyColumn.reset();
			// Keyed by block, not by slot — the container sibling's rule. A bare index
			// identifies the position, so a different block arriving at the same
			// top-level slot would silently continue the previous block's batch.
			controller.pushUndoSnapshotDebounced(
				[blockIndex],
				preEditOffset ?? 0,
				deps.blockIds[blockIndex]
			);

			// The live mutation for the structural path runs inside the ceremony so a
			// multi-block splice never touches the live children array out-of-commit.
			const preview = previewContentReparse(deps.doc.children[blockIndex], text, deps.grammar);

			if (preview.op !== 'noop') {
				const focusOffset = postEditFocusOffset ?? preEditOffset ?? 0;
				let change: StructuralChange = { op: 'noop' };
				await scope.commit({
					snapshot: 'skip',
					eventTarget: blockIndex,
					op: { kind: 'updateContent', detail: { length: text.length } },
					// ownerKind undefined is the ANSWER, not an omission: this factory is
					// the document root's, and the root imposes no body grammar. The
					// container factory is where a real owner rides.
					mutate: (view) => {
						view.unshareChild(blockIndex);
						change = performUpdate(
							{ children: view.children, ownerKind: undefined },
							blockIndex,
							text,
							deps.grammar
						);
						stampStructuralChange(view.children, change, view.sharing);
						return change;
					},
					afterTick: () => focusAfterContentReplace([], blockIndex, change, focusOffset, scope)
				});
				return;
			}

			// Routine typing (kind held, single block): out-of-ceremony in-place
			// write — copy the node first when a snapshot shares it (once per
			// keystroke batch). The debounced snapshot above holds the undo seam;
			// `input` edit events fire at debounce-flush time.
			ensureUnsharedPath(deps.doc, [blockIndex], deps.sharing);
			performUpdate(deps.doc, blockIndex, text, deps.grammar);
		}
	};
}
