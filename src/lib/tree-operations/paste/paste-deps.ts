/**
 * Narrow surface paste modules need from the commit/undo layer. Defining it
 * inside `tree-operations/paste/` flips the dependency direction: paste declares
 * what it needs; editor-actions supplies it. This keeps the backwards import
 * from `tree-operations/paste/* -> editor-actions/` out, and — via `resolveState`
 * / `expectState` — keeps the `tree-operations -> reactivity` node→state edge out
 * too.
 */

import type { CommitMultiScopeArgs, MultiScopeTarget } from '../../action-contracts';
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
	 * Land the caret at a doc-absolute path, revealing an off-window target first.
	 * Every structural paste lands at the END of the pasted run, so its target
	 * index scales with the CLIPBOARD, not with where the caret was — a sync ref
	 * lookup would silently no-op past the window's overscan (VR-12). One reveal
	 * seam for all of them; supplied by the editor-actions factory so a paste
	 * module never imports the focus layer — the one back-edge that made
	 * `tree-operations -> editor-actions` a cycle.
	 */
	landCaret(path: number[], offset: number): Promise<void>;
}
