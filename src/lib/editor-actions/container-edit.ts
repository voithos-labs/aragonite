/**
 * The root ContainerEditActions: what a container reaches the editor root for, which is the
 * document's line ending, the container commit, the two things a keystroke needs the root for
 * (its undo entry, and the write that keeps the leaf in place), the caret landing, and a block's
 * removal whole through the range-edit core.
 */

import type { ContainerEditActions } from '../action-contracts';
import { documentLineEnding } from '../core/lines';
import { emitCommitError } from '../editor-events';
import type { EditorActionsDeps, UndoController } from './deps';
import { removeWholeBlock } from '../selection/cross-block/range-removal';
import { blockNodeAt } from '../tree-operations/node-primitives';

export function createContainerEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): ContainerEditActions {
	return {
		lineEnding: () => documentLineEnding(deps.doc),
		partedBelow(path) {
			// The first block after the container, at whatever depth one stands, is what reads on.
			for (let depth = path.length; depth > 0; depth--) {
				const above = path.slice(0, depth - 1);
				const siblings =
					above.length === 0 ? deps.doc.children : blockNodeAt(deps.doc, above)?.children;
				const next = siblings?.[path[depth - 1] + 1];
				if (next) return /^[ \t]*\r?\n/.test(next.leadingTrivia ?? '');
			}
			return true;
		},
		commitContainer: (args) => controller.commitContainerStructural(args),
		typingKeystroke: (leafPath, preEditOffset, batchKey, history, work) =>
			controller.typingKeystroke(leafPath, preEditOffset, batchKey, history, work),
		typeLeaf: (leafPath, write, caret, op) => controller.typeLeaf(leafPath, write, caret, op),
		land: (pos) => deps.caretLanding.land(pos),
		removeWhole: (path, gesture, commit) =>
			removeWholeBlock(
				{ bytes: deps.bytes, reading: deps.reading, controller },
				path,
				gesture,
				commit
			),
		reportCommitError: (error, op, path) => emitCommitError(deps.events, { error, op, path })
	};
}
