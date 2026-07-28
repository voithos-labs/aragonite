/**
 * Per-level adapter for the shared block-edit core. Captures everything that
 * differs between a top-level edit (commits to the document children via
 * `commitStructural`) and a container edit (commits to a nested children
 * array via `commitContainer`): the commit ceremony, child addressing, refs,
 * and the unshare primitive. Both factories are the SINGLE mint point for the
 * commit args' doc-absolute paths (snapshot restore + event target), minted as
 * `DocPath` — the core hands over local indices only. The commit-arg path
 * fields carry `DocPath`, so the mint survives to the commit seam; G1.16 stays
 * the runtime belt for the JS callers types don't bind.
 */

import type { OpDescriptor } from '../schema/operations';
import type { CommitAfterTick } from '../action-contracts';
import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { StructuralChange } from '../tree-operations/structural-change';
import type { SharingState } from '../tree-operations/sharing';
import type { GrammarView } from '../schema/block-openers';
import type { BlockComponent } from '../block-component';
import { ensureUnsharedPath, ensureUnsharedChild } from '../tree-operations';
import { asDocPath } from '../selection/path-math';
import { extendDocPath } from '../cursor/coordinate-spaces';
import type { EditorActionsDeps, UndoController } from './deps';
import type { NestedActionsDeps } from './nested/nested-actions';
import type { BlockListState } from '../reactivity/block-list-state.svelte';

/** Owned mutation view the core's `mutate` writes through — uniform across levels. */
export interface MutationView {
	children: CstNode[];
	sharing: SharingState;
	/** The instance's block grammar, for mutations that re-parse. Absent = the global grammar. */
	grammar?: GrammarView;
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
	afterTick?: CommitAfterTick;
	/**
	 * Leaf(ves) the dev staleness oracle checks when `mutate` returns `noop` (an
	 * in-place metadata/kind write the StructuralChange can't name). The owned copy
	 * exists only after `mutate` runs, so callers push into a stable array the
	 * ceremony reads post-mutate. Top-level only — the container scope's ceremony
	 * auto-derives from its owned scope node.
	 */
	touchedNodes?: CstNode[];
	/**
	 * Structural op that can legitimately no-op (chrome split, no-target merge):
	 * when `mutate` reports no structural change, the ceremony discards the
	 * snapshot instead of minting a dead undo entry. Never set on content/metadata
	 * commits — their `noop` still carries a byte change. See action-contracts `DiscardIfNoop`.
	 */
	discardIfNoop?: boolean;
}

export interface CommitScope {
	/** Read accessor — mutation happens through the commit's owned view, never this. */
	children(): readonly NodeView[];
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
		commit({
			snapshot,
			eventTarget,
			op,
			mutate,
			afterTick,
			touchedNodes,
			discardIfNoop
		}): Promise<void> {
			return controller.commitStructural({
				snapshot:
					snapshot === 'skip'
						? 'skip'
						: { path: asDocPath([snapshot.index]), offset: snapshot.offset },
				mutate: (children) =>
					mutate({
						children,
						sharing: deps.sharing,
						grammar: deps.grammar,
						unshareChild: (i) => ensureUnsharedPath({ children }, [i], deps.sharing)[0]
					}),
				op: { ...op, eventPath: asDocPath([eventTarget]) },
				afterTick,
				touchedNodes,
				discardIfNoop
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
		commit({ snapshot, eventTarget, op, mutate, afterTick, discardIfNoop }): Promise<void> {
			return deps.parent.containerEdit.commitContainer({
				containerNode: deps.node,
				path: deps.path,
				state,
				snapshot:
					snapshot === 'skip'
						? 'skip'
						: { path: extendDocPath(deps.path, snapshot.index), offset: snapshot.offset },
				mutate: (scope) =>
					mutate({
						children: scope.children,
						sharing: scope.sharing,
						grammar: deps.grammar,
						unshareChild: (i) => ensureUnsharedChild(scope.node, i, scope.sharing)
					}),
				op: { ...op, eventPath: extendDocPath(deps.path, eventTarget) },
				afterTick,
				discardIfNoop
			});
		}
	};
}
