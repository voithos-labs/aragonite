/**
 * What paste modules need from the commit/undo layer. Declared here rather than imported,
 * which is what keeps the `tree-operations -> editor-actions` and
 * `tree-operations -> reactivity` back-edges out of the graph.
 */

import type { CommitMultiScopeArgs, MultiScopeTarget } from '../../action-contracts';
import type { CstNode } from '../../core/nodes';

export type { CommitMultiScopeArgs, MultiScopeTarget };

export interface PasteCommitCoordinator {
	commitMultiScope<const S extends readonly MultiScopeTarget[]>(
		args: CommitMultiScopeArgs<S>
	): Promise<void>;
	getDocScope(): MultiScopeTarget;
	/** Resolve a container node to its mounted reactive state. */
	resolveState(node: CstNode): MultiScopeTarget['state'] | undefined;
	/**
	 * Land the caret at a document-absolute path, scrolling an unmounted target into view
	 * first. A structural paste lands at the end of the pasted run, so its target index scales
	 * with the clipboard, and a synchronous ref lookup would do nothing past the mounted range
	 * (VR-12).
	 */
	landCaret(path: number[], offset: number): Promise<void>;
}
