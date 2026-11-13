/** The narrow commit interface `tree-operations/paste/` depends on instead of importing
 *  editor-actions. */

import type { PasteCommitCoordinator } from '../tree-operations/paste/paste-deps';
import type { EditorActionsDeps, UndoController } from './deps';
import { getStateForNode } from '../block-lists/state-registry';
import { commitLeafTextAt, contentUpdate, createBlockEditCore } from './block-edit-core';
import { refusedWrite } from './stored-caret';
import { createPathScope } from './block-edit-scope';
import { previewContentReparse } from './replacement-focus';
import { docPathFrom } from '../core/coordinate-spaces';
import type { DocumentView } from '../core/node-views';
import type { GrammarView } from '../schema/block-openers';
import { legalizeWrite } from '../tree-operations/content-write';

export function createPasteCoordinator(
	deps: EditorActionsDeps,
	controller: UndoController
): PasteCommitCoordinator {
	const root = { deps, controller };

	const coordinator: PasteCommitCoordinator = {
		commitMultiScope: controller.commitMultiScope,
		getDocScope: controller.getDocScope,
		// editor-actions may import reactivity; handing it over here keeps `tree-operations/paste/`
		// from importing it itself.
		resolveState: getStateForNode,
		commitLeafText: (leafPath, text, opts) => commitLeafTextAt(root, leafPath, text, opts),
		writeLeaf(leafPath, text, preEditOffset, caret) {
			const scope = createPathScope(root, docPathFrom(leafPath.slice(0, -1)));
			if (!scope) return refusedWrite();
			const index = leafPath[leafPath.length - 1];
			const pasted = contentUpdate(scope, { kind: 'paste', detail: { count: 0 } });
			return pasted(index, text, 'literal', 'join-typing', preEditOffset, caret);
		},
		landsAsWritten: (leafPath, text) =>
			leafWriteLands(deps.doc, leafPath, text, deps.reading.grammar),
		async replaceBlock(blockPath, replacement, focus, opts) {
			const scope = createPathScope(root, docPathFrom(blockPath.slice(0, -1)));
			if (!scope) return null;
			return createBlockEditCore(scope).replaceBlock(
				blockPath[blockPath.length - 1],
				replacement,
				focus,
				opts
			);
		},
		async insertParagraph(boundaryPath, text) {
			const scope = createPathScope(root, docPathFrom(boundaryPath.slice(0, -1)));
			if (!scope) return false;
			return createBlockEditCore(scope).insertParagraph(
				boundaryPath[boundaryPath.length - 1],
				text
			);
		}
	};
	return coordinator;
}

/** Whether a block's own write of `text` at `path` in `doc` stores exactly those bytes: a top-level
 *  block (a container rebuilds around it) whose rule keeps them, read as one block of its kind. */
export function leafWriteLands(
	doc: DocumentView,
	path: readonly number[],
	text: string,
	grammar: GrammarView
): boolean {
	if (path.length !== 1) return false;
	const write = legalizeWrite(doc, path[0], text, 'literal', grammar);
	return write.text === text && previewContentReparse(doc, path[0], write, grammar).op === 'noop';
}
