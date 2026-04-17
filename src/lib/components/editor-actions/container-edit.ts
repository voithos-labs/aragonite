/**
 * ContainerEditActions factory: snapshot bookends invoked by container
 * blocks (lists, blockquotes) around their internal mutations, plus a
 * top-level reactivity nudge when a nested edit completes.
 */

import type { ContainerEditActions } from '../../contracts';
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
		}
	};
}
