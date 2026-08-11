/**
 * Per-level adapter for the shared block-edit core: commit ceremony, child addressing, refs and
 * unshare, for a top-level edit vs a container one. Both factories are the SINGLE mint point for
 * the commit args' doc-absolute paths, as `DocPath` — the core hands over local indices only.
 * G1.16 stays the runtime belt for the JS callers types don't bind.
 */

import type { OpDescriptor } from '../schema/operations';
import type { CommitAfterTick } from '../action-contracts';
import type { AnyBlockKind, CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { StructuralChange } from '../tree-operations/structural-change';
import type { SharingState } from '../tree-operations/sharing';
import type { GrammarView } from '../schema/block-openers';
import type { InlineResolverRef } from '../schema/inline-construct-policy';
import type { PresentationModeGetter } from '../editor-keys';
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
	/** The container these children belong to, for mutations whose bytes must satisfy
	 *  its grammar (`bodyWrite`). Absent at the document root. */
	ownerKind?: AnyBlockKind;
	/** The container NODE itself, for settles that write its wrap slots. Nullable
	 *  rather than optional so each adapter answers; `undefined` is the document root. */
	owner: CstNode | undefined;
	/** The instance's block grammar, for mutations that re-parse. Absent = the global grammar. */
	grammar?: GrammarView;
	/** Live EFFECTIVE mode, for mutations whose bytes depend on what the mode paints. Nullable
	 *  rather than optional so each adapter answers; `undefined` reads as not-live. */
	getPresentationMode: PresentationModeGetter | undefined;
	/** The instance's link-reference resolver, so a rewrite parses the reference forms the render
	 *  path drew. Nullable for the same reason as the mode; `undefined` reads them as brackets. */
	linkRef: InlineResolverRef | undefined;
	/** Copy-out-of-sharing the child at `i` before an in-place write; returns the owned node. */
	unshareChild(i: number): CstNode;
}

export interface ScopeCommitArgs {
	/** Snapshot coordinate in THIS scope's local index space, or 'skip' to join a caller's entry. */
	snapshot: { index: number; offset: number } | 'skip';
	/** Local index the edit event targets; the factory prefixes the scope's absolute path. */
	eventTarget: number;
	op: OpDescriptor;
	mutate: (view: MutationView) => StructuralChange;
	afterTick?: CommitAfterTick;
	/**
	 * Leaves the dev staleness oracle checks when `mutate` returns `noop`. The owned
	 * copy exists only after `mutate` runs, hence a stable array. Top-level only.
	 */
	touchedNodes?: CstNode[];
	/**
	 * A structural op that can legitimately no-op, so the ceremony discards the snapshot
	 * rather than mint a dead entry. Never on content/metadata commits — their `noop`
	 * still carries a byte change (action-contracts `DiscardIfNoop`).
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
						owner: undefined,
						grammar: deps.grammar,
						getPresentationMode: deps.getPresentationMode,
						linkRef: deps.linkRef,
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
						ownerKind: scope.node.kind,
						owner: scope.node,
						grammar: deps.grammar,
						getPresentationMode: deps.getPresentationMode,
						linkRef: deps.linkRef,
						unshareChild: (i) => ensureUnsharedChild(scope.node, i, scope.sharing)
					}),
				op: { ...op, eventPath: extendDocPath(deps.path, eventTarget) },
				afterTick,
				discardIfNoop
			});
		}
	};
}
