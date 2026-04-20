/**
 * ContainerEditActions factory: snapshot bookends invoked by container
 * blocks (lists, blockquotes) around their internal mutations, plus the
 * unified `commitContainer` entry that routes structural mutations
 * through the commit primitive.
 */

import type { ContainerEditActions } from '../../contracts';
import type { OperationKind } from '../../debug/operations-log';
import type { EditorActionsDeps, UndoController } from './deps';

export function createContainerEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): ContainerEditActions {
	return {
		beginContainerEdit(blockIndex: number, offset: number): void {
			deps.stickyColumn.reset();
			controller.clearDebouncedCheckpoint();
			controller.pushUndoSnapshot(blockIndex, offset);
		},

		beginContainerEditDebounced(blockIndex: number, offset: number): void {
			deps.stickyColumn.reset();
			controller.pushUndoSnapshotDebounced(blockIndex, offset);
		},

		endContainerEdit(): void {
			deps.setDocChildren([...deps.doc.children]);
		},

		commitContainer(containerNode, state, snapshot, mutate, afterTick, op): Promise<void> {
			return controller.commitContainerStructural(
				containerNode,
				state,
				snapshot,
				mutate,
				afterTick,
				// The public interface uses `string` for op.kind; narrow to the
				// internal OperationKind union here. Callers pass known kinds
				// ('split' | 'merge' | 'delete' | 'updateContent' | 'paste' |
				// 'replaceBlock'); the cast can be tightened post-0.5.4.
				op
					? {
							kind: op.kind as OperationKind,
							detail: op.detail,
							eventPath: op.eventPath
						}
					: undefined
			);
		}
	};
}
