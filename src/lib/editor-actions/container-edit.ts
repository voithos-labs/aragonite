/**
 * ContainerEditActions factory: the debounced checkpoint pusher for raw typing
 * outside the commit primitive, the doc-root reactivity nudge, and `commitContainer`.
 */

import type { ContainerEditActions } from '../action-contracts';
import type { CstNode } from '../core/nodes';
import type { SharingState } from '../tree-operations/sharing';
import {
	ensureUnsharedPath,
	rebuildUnsharedChain,
	type AncestrySeamFold
} from '../tree-operations/unshare';
import { publishAncestryFolds } from './ancestry-folds';
import type { EditorActionsDeps, UndoController } from './deps';

export function createContainerEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): ContainerEditActions {
	return {
		pushDebouncedCheckpoint(leafPath: number[], offset: number, batchKey?: string | number): void {
			deps.stickyColumn.reset();
			deps.edgeAffinity.reset();
			controller.pushUndoSnapshotDebounced(leafPath, offset, batchKey);
		},

		nudgeReactivity(): void {
			// Raw mutations made outside the commit primitive surface through this nudge,
			// so Svelte re-reads doc.children.
			deps.doc.children = [...deps.doc.children];
		},

		withUnsharedSpine(
			absPath: number[],
			write: (chain: CstNode[], sharing: SharingState) => void
		): boolean {
			const chain = ensureUnsharedPath(deps.doc, absPath, deps.sharing);
			write(chain, deps.sharing);
			// This path publishes no descriptor of its own, so the ancestry settle's folds are
			// resynced here — the routine-typing twin of the ceremony's own reconcile.
			const folds: AncestrySeamFold[] = [];
			const replacements = rebuildUnsharedChain(deps.doc, chain, deps.sharing, folds, deps.grammar);
			publishAncestryFolds(deps, folds);
			return replacements.length > 0;
		},

		commitContainer(args): Promise<void> {
			return controller.commitContainerStructural(args);
		}
	};
}
