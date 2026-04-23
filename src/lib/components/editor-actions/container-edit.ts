/**
 * ContainerEditActions factory — snapshot bookends for container blocks
 * plus the unified `commitContainer` entry that routes structural
 * mutations through the commit primitive.
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
			// Reactivity nudge for paths that mutate the document outside the
			// commit primitive — cross-block typing, IME composition entry,
			// drag/clipboard mutate notify.
			deps.doc.children = [...deps.doc.children];
		},

		commitContainer(containerNode, state, snapshot, mutate, afterTick, op): Promise<void> {
			return controller.commitContainerStructural(
				containerNode,
				state,
				snapshot,
				mutate,
				afterTick,
				// Public interface widens to `string` for ergonomics; OperationKind
				// is the internal source of truth.
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
