/**
 * Per-level adapter for the shared block-edit core. Captures everything that
 * differs between a top-level edit (commits to the document children via
 * `commitStructural`) and a container edit (commits to a nested children
 * array via `commitContainer`): the commit ceremony, child addressing, refs,
 * and the unshare primitive. Both factories are the SINGLE mint point for the
 * commit args' doc-absolute paths (snapshot restore + event target) — the
 * core hands over local indices only.
 */

import type { OpDescriptor } from '../schema/operations';
import type { CstNode } from '../core/nodes';
import type { StructuralChange } from '../tree-operations/structural-change';
import type { SharingState } from '../tree-operations/sharing';
import type { BlockComponent } from '../block-component';
import { ensureUnsharedPath, ensureUnsharedChild } from '../tree-operations';
import type { EditorActionsDeps, UndoController } from './deps';
import type { NestedActionsDeps } from './nested/nested-actions';
import type { BlockListState } from '../reactivity/block-list-state.svelte';

/** Owned mutation view the core's `mutate` writes through — uniform across levels. */
export interface MutationView {
	children: CstNode[];
	sharing: SharingState;
	/** Copy-out-of-sharing the child at `i` before an in-place write; returns the owned node. */
	unshareChild(i: number): CstNode;
}

export interface ScopeCommitArgs {
	/** Snapshot coordinate in THIS scope's local index space, or 'skip' to join a caller's entry. */
	snapshot: { index: number; offset: number } | 'skip';
	/** The local index the emitted edit event targets (often the op's index; the deleted neighbor for not-editable merges; the minted index for inserts). The factory prefixes the scope's absolute path. */
	eventTarget: number;
	op: OpDescriptor;
	mutate: (view: MutationView) => StructuralChange;
	afterTick?: () => void;
}

export interface CommitScope {
	children(): CstNode[];
	refAt(i: number): BlockComponent | undefined;
	/** Empty replaceBlock emits `delete` (container) vs `replaceBlock{count:0}` (top-level). */
	collapseEmptyReplaceToDelete: boolean;
	commit(args: ScopeCommitArgs): Promise<void>;
}

// ── Top-level adapter ────────────────────────────────────────────────────────

export function createTopLevelScope(
	deps: EditorActionsDeps,
	controller: UndoController
): CommitScope {
	return {
		children: () => deps.doc.children,
		refAt: (i) => deps.blockRefs[i],
		collapseEmptyReplaceToDelete: false,
		commit({ snapshot, eventTarget, op, mutate, afterTick }): Promise<void> {
			return controller.commitStructural({
				snapshot:
					snapshot === 'skip' ? 'skip' : { path: [snapshot.index], offset: snapshot.offset },
				mutate: (children) =>
					mutate({
						children,
						sharing: deps.sharing,
						unshareChild: (i) => ensureUnsharedPath({ children }, [i], deps.sharing)[0]
					}),
				op: { ...op, eventPath: [eventTarget] },
				afterTick
			});
		}
	};
}

// ── Container adapter ────────────────────────────────────────────────────────

export function createContainerScope(state: BlockListState, deps: NestedActionsDeps): CommitScope {
	return {
		children: () => deps.node.children ?? [],
		refAt: (i) => state.innerBlockRefs[i],
		collapseEmptyReplaceToDelete: true,
		commit({ snapshot, eventTarget, op, mutate, afterTick }): Promise<void> {
			return deps.parent.containerEdit.commitContainer({
				containerNode: deps.node,
				path: deps.path,
				state,
				snapshot:
					snapshot === 'skip'
						? 'skip'
						: { path: [...deps.path, snapshot.index], offset: snapshot.offset },
				mutate: (scope) =>
					mutate({
						children: scope.children,
						sharing: scope.sharing,
						unshareChild: (i) => ensureUnsharedChild(scope.node, i, scope.sharing)
					}),
				op: { ...op, eventPath: [...deps.path, eventTarget] },
				afterTick
			});
		}
	};
}
