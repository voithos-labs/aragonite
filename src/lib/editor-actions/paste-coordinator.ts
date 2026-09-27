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

	async function landCaret(path: number[], offset: number): Promise<void> {
		const stamp = controller.historyGeneration();
		const block = await deps.revealPath(path);
		// An undo or redo that finished while the target was scrolling into view swapped
		// the tree, so this path may name a different block than the paste aimed at.
		if (controller.historyGeneration() !== stamp) return;
		block?.focus(offset);
	}

	const coordinator: PasteCommitCoordinator = {
		commitMultiScope: controller.commitMultiScope,
		getDocScope: controller.getDocScope,
		// editor-actions may import reactivity and the reveal; handing them over here keeps
		// `tree-operations/paste/` from importing either itself.
		resolveState: getStateForNode,
		landCaret,
		commitLeafText: (leafPath, text, opts) => commitLeafTextAt(root, leafPath, text, opts),
		async replaceBlock(blockPath, replacement, focus, opts) {
			// Every paste lands through the coordinator's one landing, which gives up after an undo.
			const scope = createPathScope(root, docPathFrom(blockPath.slice(0, -1)), (pos) =>
				coordinator.landCaret([...pos.path], pos.offset)
			);
			if (!scope) return null;
			return createBlockEditCore(scope).replaceBlock(
				blockPath[blockPath.length - 1],
				replacement,
				focus,
				{ ...opts, snapshotOffset: 0 }
			);
		}
	};
	return coordinator;
}
