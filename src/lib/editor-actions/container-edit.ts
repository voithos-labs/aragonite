/**
 * ContainerEditActions factory: the debounced checkpoint pusher for raw typing
 * outside the commit primitive, the doc-root reactivity nudge, and `commitContainer`.
 */

import type { ContainerEditActions } from '../action-contracts';
import type { CstNode } from '../core/nodes';
import { ensureUnsharedPath, rebuildUnsharedChain } from '../tree-operations/unshare';
import type { EditorActionsDeps, UndoController } from './deps';

export function createContainerEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): ContainerEditActions {
	return {
		pushDebouncedCheckpoint(leafPath: number[], offset: number, batchKey?: string | number): void {
			deps.stickyColumn.reset();
			controller.pushUndoSnapshotDebounced(leafPath, offset, batchKey);
		},

		nudgeReactivity(): void {
			// Raw mutations made outside the commit primitive surface through this nudge,
			// so Svelte re-reads doc.children.
			deps.doc.children = [...deps.doc.children];
		},

		withUnsharedSpine(absPath: number[], write: (chain: CstNode[]) => void): boolean {
			const chain = ensureUnsharedPath(deps.doc, absPath, deps.sharing);
			write(chain);
			const replacements = rebuildUnsharedChain(deps.doc, chain, deps.sharing, deps.grammar);
			return replacements.length > 0;
		},

		commitContainer(args): Promise<void> {
			return controller.commitContainerStructural(args);
		}
	};
}
