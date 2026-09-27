/**
 * The top-level BlockEditActions: the shared `block-edit-core` against a top-level
 * `CommitScope`, with the edge guards the root adds.
 */

import type { BlockEditActions } from '../action-contracts';
import { documentLineEnding } from '../core/lines';
import type { EditorActionsDeps, UndoController } from './deps';
import { createTopLevelScope } from './block-edit-scope';
import { contentUpdate, createBlockEditCore } from './block-edit-core';
import { withEnterCompletion } from './enter-completion';

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

		updateBlockContent: contentUpdate(scope)
	};

	return withEnterCompletion(
		actions,
		(blockIndex) => scope.children()[blockIndex],
		deps.reading.grammar,
		() => documentLineEnding(deps.doc)
	);
}
