/** The narrow commit interface `tree-operations/paste/` depends on instead of importing
 *  editor-actions. */

import type { PasteCommitCoordinator } from '../tree-operations/paste/paste-deps';
import type { EditorActionsDeps, UndoController } from './deps';
import { getStateForNode } from '../reactivity/state-registry';
import { commitLeafTextAt, createBlockEditCore } from './block-edit-core';
import { createPathScope } from './block-edit-scope';
import { docPathFrom } from '../cursor/coordinate-spaces';

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
		async replaceBlock(blockPath, replacement, focus, opts) {
			const scope = createPathScope(root, docPathFrom(blockPath.slice(0, -1)));
			if (!scope) return null;
			return createBlockEditCore(scope).replaceBlock(
				blockPath[blockPath.length - 1],
				replacement,
				focus,
				{ ...opts, snapshotOffset: opts.snapshotOffset ?? 0 }
			);
		}
	};
	return coordinator;
}
