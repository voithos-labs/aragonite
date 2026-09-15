/**
 * Per-level adapter for the shared block-edit core: the commit, child addressing, refs and
 * copy-before-write, for a top-level edit or a container one. The two factories are the only
 * place the commit's document-absolute paths (`DocPath`) are made; the core hands over local
 * indices only. G1.16 is the runtime check for JS callers the types do not bind.
 */

import type { OpDescriptor } from '../schema/operations';
import type { CommitAfterTick, ContainerScope } from '../action-contracts';
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

/** The copied children the core's `mutate` writes through, the same shape at both levels. */
export interface MutationView {
	children: CstNode[];
	sharing: SharingState;
	/** The container these children belong to, for mutations whose bytes must satisfy
	 *  its grammar (`bodyWrite`). Absent at the document root. */
	ownerKind?: AnyBlockKind;
	/** The container node itself, for fix-ups that write its opener or closer. Nullable
	 *  rather than optional so each adapter answers; `undefined` is the document root. */
	owner: CstNode | undefined;
	/** The instance's block grammar, for mutations that re-parse. Absent = the global grammar. */
	grammar?: GrammarView;
	/** The live effective mode, for mutations whose bytes depend on what the mode shows. Nullable
	 *  rather than optional so each adapter answers; `undefined` reads as not live. */
	getPresentationMode: PresentationModeGetter | undefined;
	/** The instance's link-reference resolver, so a rewrite parses the reference links the
	 *  renderer drew. Nullable for the same reason as the mode; `undefined` reads them as brackets. */
	linkRef: InlineResolverRef | undefined;
	/** Copy the child at `i` out of the undo snapshot before an in-place write; returns the copy. */
	unshareChild(i: number): CstNode;
}

export interface ScopeCommitArgs {
	/** Undo snapshot position as a local index in this list, or 'skip' to join a caller's entry. */
	snapshot: { index: number; offset: number } | 'skip';
	/** Local index the edit event targets; the factory prefixes the scope's absolute path. */
	eventTarget: number;
	op: OpDescriptor;
	mutate: (view: MutationView) => StructuralChange;
	afterTick?: CommitAfterTick;
	/**
	 * The nodes the dev-mode stale-raw check reads when `mutate` returns `noop`. The copy
	 * exists only after `mutate` runs, hence a stable array filled later. Top-level only.
	 */
	touchedNodes?: CstNode[];
	/**
	 * A structural edit that can legitimately change nothing, so the commit discards the
	 * snapshot rather than push a dead entry. Never on content or metadata commits: their
	 * `noop` still carries a byte change (action-contracts `DiscardIfNoop`).
	 */
	discardIfNoop?: boolean;
}

export interface CommitScope {
	/** Read only; mutation goes through the commit's copied view, never this. */
	children(): readonly NodeView[];
	refAt(i: number): BlockComponent | undefined;
	/** An empty replaceBlock emits `delete` (container) or `replaceBlock{count:0}` (top-level). */
	collapseEmptyReplaceToDelete: boolean;
	commit(args: ScopeCommitArgs): Promise<void>;
}

/** The owner the tree operations read for a container commit, {@link MutationView}'s counterpart. */
export const scopeParentOf = (scope: ContainerScope) => ({
	children: scope.children,
	ownerKind: scope.node.kind,
	owner: scope.node
});

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
		// A collapse at this container's own index detaches it (`tree-operations/chain-rebuild.ts`),
		// so a post-commit read can find the container gone rather than merely empty.
		children: () => deps.node?.children ?? [],
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
