/**
 * Top-level BlockEditActions factory. Structural mutations route through the shared
 * `block-edit-core` against a top-level `CommitScope`; this factory adds the edge
 * guards and the one per-level body the core can't share, `updateBlockContent`.
 */

import type { BlockEditActions } from '../action-contracts';
import { updateNodeContent as performUpdate, ensureUnsharedPath } from '../tree-operations';
import { stampStructuralChange, type StructuralChange } from '../tree-operations/structural-change';
import type { EditorActionsDeps, UndoController } from './deps';
import { createTopLevelScope } from './block-edit-scope';
import { createBlockEditCore } from './block-edit-core';
import { withEnterCompletion } from './enter-completion';
import { previewContentReparse, focusAfterContentReplace } from './replacement-focus';

export function createBlockEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): BlockEditActions {
	const scope = createTopLevelScope(deps, controller);
	const core = createBlockEditCore(scope);

	const actions: BlockEditActions = {
		// ── Structural split / merge / delete (shared core) ───────────────────

		splitBlock: (blockIndex, offset) => core.split(blockIndex, offset),
		descendToBody: (blockIndex) => core.descendToBody(blockIndex),
		insertParagraph: (boundaryIndex, text) => core.insertParagraph(boundaryIndex, text),

		async mergeWithPrevious(blockIndex) {
			deps.stickyColumn.reset();
			deps.edgeAffinity.reset();
			if (blockIndex <= 0) return;
			await core.mergeWithPreviousInterior(blockIndex);
		},

		async mergeWithNext(blockIndex) {
			deps.stickyColumn.reset();
			deps.edgeAffinity.reset();
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
			deps.edgeAffinity.reset();
			// Keyed by block, not by slot: a bare index identifies the position, so a
			// different block arriving at the same slot would continue its batch.
			controller.pushUndoSnapshotDebounced(
				[blockIndex],
				preEditOffset ?? 0,
				deps.blockIds[blockIndex]
			);

			// The structural path's live mutation runs inside the ceremony, so a
			// multi-block splice never touches the live children array out-of-commit.
			const preview = previewContentReparse(
				deps.doc.children[blockIndex],
				text,
				deps.grammar,
				undefined,
				blockIndex === deps.doc.children.length - 1 ? deps.doc.suffix : ''
			);

			if (preview.op !== 'noop') {
				const focusOffset = postEditFocusOffset ?? preEditOffset ?? 0;
				let change: StructuralChange = { op: 'noop' };
				await scope.commit({
					snapshot: 'skip',
					eventTarget: blockIndex,
					op: { kind: 'updateContent', detail: { length: text.length } },
					// ownerKind undefined is the ANSWER, not an omission: the document root
					// imposes no body grammar. The suffix rides as accessors so the tail
					// settle folds against the live document.
					mutate: (view) => {
						view.unshareChild(blockIndex);
						change = performUpdate(
							{
								children: view.children,
								ownerKind: undefined,
								owner: undefined,
								get suffix() {
									return deps.doc.suffix;
								},
								set suffix(value: string) {
									deps.doc.suffix = value;
								}
							},
							blockIndex,
							text,
							deps.grammar,
							view.sharing
						);
						stampStructuralChange(view.children, change, view.sharing);
						return change;
					},
					afterTick: () => focusAfterContentReplace([], blockIndex, change, focusOffset, scope)
				});
				return;
			}

			// Routine typing: an out-of-ceremony in-place write, so copy the node first when a
			// snapshot shares it. Slotless parent on purpose — the preview already routed every
			// suffix materialization into the ceremony, so none can happen here.
			ensureUnsharedPath(deps.doc, [blockIndex], deps.sharing);
			performUpdate(
				{ children: deps.doc.children, ownerKind: undefined, owner: undefined },
				blockIndex,
				text,
				deps.grammar,
				deps.sharing
			);
		}
	};

	return withEnterCompletion(actions, (blockIndex) => scope.children()[blockIndex]);
}
