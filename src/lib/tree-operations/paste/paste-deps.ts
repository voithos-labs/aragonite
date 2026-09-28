/**
 * What paste modules need from the commit/undo layer. Declared here rather than imported,
 * which is what keeps the `tree-operations -> editor-actions` and
 * `tree-operations -> reactivity` back-edges out of the graph.
 */

import type {
	CommitMultiScopeArgs,
	LeafTextOptions,
	LeafWriteResult,
	MultiScopeTarget,
	ReplaceFocus,
	ReplaceSource
} from '../../action-contracts';
import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';

export type { CommitMultiScopeArgs, MultiScopeTarget };

export interface PasteCommitCoordinator {
	commitMultiScope<const S extends readonly MultiScopeTarget[]>(
		args: CommitMultiScopeArgs<S>
	): Promise<boolean>;
	getDocScope(): MultiScopeTarget;
	/** Resolve a container node to its mounted reactive state. */
	resolveState(node: NodeView): MultiScopeTarget['state'] | undefined;
	/** Write `text` into the leaf at `leafPath` as one commit at its parent list, through the write
	 *  every keystroke takes. */
	commitLeafText(leafPath: number[], text: string, opts: LeafTextOptions): Promise<LeafWriteResult>;
	/** Replace the block at `blockPath` as one commit at its parent list, through the replace every
	 *  level takes. Resolves to how many blocks landed, or null when nothing was written. */
	replaceBlock(
		blockPath: number[],
		replacement: CstNode[],
		focus: ReplaceFocus,
		opts: { source: ReplaceSource; trailingBlank?: boolean }
	): Promise<number | null>;
}
