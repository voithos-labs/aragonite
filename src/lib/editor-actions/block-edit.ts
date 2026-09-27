/**
 * The top-level BlockEditActions. Structural edits go through the shared `block-edit-core`
 * against a top-level `CommitScope`; this adds the edge guards and the one per-level method
 * the core cannot share, `updateBlockContent`.
 */

import { tick } from 'svelte';
import type { BlockEditActions } from '../action-contracts';
import { documentLineEnding } from '../core/lines';
import { legalizeWrite, type LegalWrite } from '../tree-operations/content-write';
import type { EditorActionsDeps, UndoController } from './deps';
import { createTopLevelScope } from './block-edit-scope';
import { commitLeafText, createBlockEditCore } from './block-edit-core';
import { withEnterCompletion } from './enter-completion';
import { previewContentReparse, landUnlessFocusMoved } from './replacement-focus';
import { withStoredCaret } from './stored-caret';

export function createBlockEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): BlockEditActions {
	const scope = createTopLevelScope(deps, controller);
	const core = createBlockEditCore(scope);

	async function applyContentUpdate(
		blockIndex: number,
		write: LegalWrite,
		preEditOffset: number | undefined,
		caret: number
	): Promise<void> {
		const preview = previewContentReparse(scope.target(), blockIndex, write, deps.reading.grammar);
		if (preview.op !== 'noop') {
			await commitLeafText(scope, blockIndex, write, {
				snapshotOffset: preEditOffset ?? 0,
				caret,
				afterTick: (landed) => landUnlessFocusMoved(scope, landed)
			});
			return;
		}
		const written = scope.writeInPlace(blockIndex, write, caret);
		if (!written.wrote || !written.relanding) return;
		await tick();
		await landUnlessFocusMoved(scope, written.relanding);
	}

	const actions: BlockEditActions = {
		// ── Structural split / merge / delete (shared core) ───────────────────

		splitBlock: (blockIndex, offset) => core.split(blockIndex, offset),
		descendToBody: (blockIndex) => core.descendToBody(blockIndex),
		insertParagraph: (boundaryIndex, text) => core.insertParagraph(boundaryIndex, text),

		async mergeWithPrevious(blockIndex) {
			deps.caretMemory.forget();
			if (blockIndex <= 0) return;
			await core.mergeWithPreviousInterior(blockIndex);
		},

		async mergeWithNext(blockIndex) {
			deps.caretMemory.forget();
			if (blockIndex >= deps.doc.children.length - 1) return;
			await core.mergeWithNextInterior(blockIndex);
		},

		deleteBlock: (blockIndex) => core.deleteInterior(blockIndex),
		updateBlockMetadata: (blockIndex, metadata, options) =>
			core.updateBlockMetadata(blockIndex, metadata, options),
		replaceBlock: (blockIndex, replacement, focus, options) =>
			core.replaceBlock(blockIndex, replacement, focus, options),

		// ── Content update (per-level) ────────────────────────────────────────

		updateBlockContent(blockIndex, text, mode, preEditOffset, postEditFocusOffset) {
			deps.caretMemory.forget();
			const write = legalizeWrite(scope.target(), blockIndex, text, mode);
			const caret = write.storedOffset(postEditFocusOffset ?? preEditOffset ?? 0);
			const done = scope.typeIn(blockIndex, preEditOffset ?? 0, () =>
				applyContentUpdate(blockIndex, write, preEditOffset, caret)
			);
			return withStoredCaret(done, caret, write.storedOffset);
		}
	};

	return withEnterCompletion(
		actions,
		(blockIndex) => scope.children()[blockIndex],
		deps.reading.grammar,
		() => documentLineEnding(deps.doc)
	);
}
