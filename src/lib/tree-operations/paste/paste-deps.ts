/**
 * What paste modules need from the commit/undo layer. Declared here rather than imported,
 * which is what keeps the `tree-operations -> editor-actions` and
 * `tree-operations -> reactivity` back-edges out of the graph.
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
	/** Resolve a container node to its mounted reactive state. */
	resolveState(node: CstNode): MultiScopeTarget['state'] | undefined;
	/** Strict variant: throws when `node` has no mounted state. */
	expectState(node: CstNode): MultiScopeTarget['state'];
	/**
	 * Land the caret at a doc-absolute path, revealing an off-window target first. A
	 * structural paste lands at the END of the pasted run, so its target index scales with
	 * the clipboard and a sync ref lookup would no-op past the window's overscan (VR-12).
	 */
	landCaret(path: number[], offset: number): Promise<void>;
}
