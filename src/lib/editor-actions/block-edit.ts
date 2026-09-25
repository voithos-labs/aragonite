/**
 * The top-level BlockEditActions. Structural edits go through the shared `block-edit-core`
 * against a top-level `CommitScope`; this adds the edge guards and the one per-level method
 * the core cannot share, `updateBlockContent`.
 */

import { tick } from 'svelte';
import type { BlockEditActions } from '../action-contracts';
import { documentLineEnding } from '../core/lines';
import { updateNodeContent as performUpdate, ensureUnsharedPath } from '../tree-operations';
import { publishScopeFold } from './ancestry-folds';
import type { SettledContent } from '../tree-operations/content-write';
import { stampStructuralChange } from '../tree-operations/structural-change';
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

	// The keystroke's own work, split out so `updateBlockContent` owns the batch bookkeeping
	// around it and nothing inside can return past starting the pause timer.
	async function applyContentUpdate(
		blockIndex: number,
		text: string,
		preEditOffset?: number,
		postEditFocusOffset?: number
	): Promise<void> {
		// The structural path's mutation runs inside a commit, so a multi-block splice never
		// touches the live children array outside one.
		const preview = previewContentReparse(
			deps.doc.children[blockIndex],
			text,
			deps.reading.grammar,
			undefined,
			blockIndex === deps.doc.children.length - 1 ? deps.doc.suffix : '',
			documentLineEnding(deps.doc)
		);

		if (preview.op !== 'noop') {
			const focusOffset = postEditFocusOffset ?? preEditOffset ?? 0;
			let settled: SettledContent = { change: { op: 'noop' }, textStart: 0 };
			await scope.commit({
				snapshot: 'skip',
				eventTarget: blockIndex,
				op: { kind: 'updateContent', detail: { length: text.length } },
				// ownerKind undefined is the answer, not an omission: the document root has no
				// body grammar. The suffix goes as accessors so the trailing-line fix-up reads
				// and writes the live document.
				mutate: (view) => {
					view.unshareChild(blockIndex);
					settled = performUpdate(
						{
							children: view.children,
							ownerKind: undefined,
							owner: undefined,
							lineEnding: view.lineEnding,
							get suffix() {
								return deps.doc.suffix;
							},
							set suffix(value: string) {
								deps.doc.suffix = value;
							}
						},
						blockIndex,
						text,
						deps.reading.grammar,
						view.sharing
					);
					stampStructuralChange(view.children, settled.change, view.sharing);
					return settled.change;
				},
				afterTick: () => focusAfterContentReplace([], blockIndex, settled, focusOffset, scope)
			});
			return;
		}

		// Routine typing: an in-place write outside a commit, so copy the node first when an undo
		// snapshot shares it. No suffix on purpose: the trial reparse already sent every case
		// that turns the trailing line into a block through a commit, so none can happen here.
		ensureUnsharedPath(deps.doc, [blockIndex], deps.sharing);
		const settled = performUpdate(
			{
				children: deps.doc.children,
				ownerKind: undefined,
				owner: undefined,
				lineEnding: documentLineEnding(deps.doc)
			},
			blockIndex,
			text,
			deps.reading.grammar,
			deps.sharing
		);
		// Filling a blank block can still merge it into a neighbour here (the single-node trial
		// had no neighbour to merge into), so this path writes its own change to state and
		// places the caret again, which a commit would otherwise have done.
		if (settled.change.op !== 'noop') publishScopeFold(deps, undefined, settled.change);
		// After that write to state, as a commit announces after its own, and before the early
		// return: the leaf's raw is already written, and an ordinary keystroke ends as `noop`.
		deps.bumpContentVersion();
		if (settled.change.op === 'noop') return;
		await tick();
		await focusAfterContentReplace(
			[],
			blockIndex,
			settled,
			postEditFocusOffset ?? preEditOffset ?? 0,
			scope
		);
	}

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
			// Keyed by block id, not by index: a bare index names the position, so a different
			// block arriving at the same index would continue its batch.
			controller.pushUndoSnapshotDebounced(
				[blockIndex],
				preEditOffset ?? 0,
				deps.blockIds[blockIndex]
			);
			// The pause timer starts once this keystroke's own work is done, throw included: a
			// batch whose timer never started never ends by pause and swallows every later keystroke.
			try {
				await applyContentUpdate(blockIndex, text, preEditOffset, postEditFocusOffset);
			} finally {
				controller.armUndoPause();
			}
		}
	};

	return withEnterCompletion(
		actions,
		(blockIndex) => scope.children()[blockIndex],
		deps.reading.grammar,
		() => documentLineEnding(deps.doc)
	);
}
