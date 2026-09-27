/**
 * What paste modules need from the commit/undo layer. Declared here rather than imported,
 * which is what keeps the `tree-operations -> editor-actions` and
 * `tree-operations -> reactivity` back-edges out of the graph.
 */

import type {
	CommitMultiScopeArgs,
	LeafTextOptions,
	LeafWriteResult,
	MultiScopeTarget
} from '../../action-contracts';
import type { CstNode } from '../../core/nodes';

export type { CommitMultiScopeArgs, MultiScopeTarget };

export interface PasteCommitCoordinator {
	commitMultiScope<const S extends readonly MultiScopeTarget[]>(
		args: CommitMultiScopeArgs<S>
	): Promise<boolean>;
	getDocScope(): MultiScopeTarget;
	/** Resolve a container node to its mounted reactive state. */
	resolveState(node: CstNode): MultiScopeTarget['state'] | undefined;
	/** Land the caret at a document-absolute path, scrolling an unmounted target into view first,
	 *  since a structural paste's target can sit past the mounted range (VR-12). */
	landCaret(path: number[], offset: number): Promise<void>;
	/** Write `text` into the leaf at `leafPath` as one commit at its parent list, through the write
	 *  every keystroke takes. */
	commitLeafText(leafPath: number[], text: string, opts: LeafTextOptions): Promise<LeafWriteResult>;
}
