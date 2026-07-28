/**
 * Narrow surface paste modules need from the commit/undo layer. Defining it
 * inside `tree-operations/paste/` flips the dependency direction: paste declares
 * what it needs; editor-actions supplies it. This keeps the backwards import
 * from `tree-operations/paste/* -> editor-actions/` out, and — via `resolveState`
 * / `expectState` — keeps the `tree-operations -> reactivity` node→state edge out
 * too.
 */

import type { CommitMultiScopeArgs, MultiScopeTarget } from '../../action-contracts';
import type { BlockComponent } from '../../block-component';
import type { CstNode } from '../../core/nodes';
import type { SharingState } from '../sharing';

export type { CommitMultiScopeArgs, MultiScopeTarget };

export interface PasteCommitCoordinator {
	sharing: SharingState;
	commitMultiScope<const S extends readonly MultiScopeTarget[]>(
		args: CommitMultiScopeArgs<S>
	): Promise<void>;
	getDocScope(): MultiScopeTarget;
	/**
	 * Resolve a container node to its mounted reactive state. Supplied by the
	 * editor-actions factory so paste modules never import `reactivity/` directly.
	 */
	resolveState(node: CstNode): MultiScopeTarget['state'] | undefined;
	/** Strict variant — throws when `node` has no mounted state (caller guarantees a mounted container). */
	expectState(node: CstNode): MultiScopeTarget['state'];
	/**
	 * Land the caret at a sub-path within a container's mounted refs, for the
	 * post-commit focus a paste owns itself. Supplied by the editor-actions factory
	 * so a paste module never imports the focus dispatcher — the one back-edge that
	 * made `tree-operations -> editor-actions` a cycle.
	 */
	focusByPath(refs: (BlockComponent | undefined)[], path: number[], offset: number): void;
}
