/**
 * What paste modules need from the commit/undo layer. Declared here rather than imported,
 * which is what keeps the `tree-operations -> editor-actions` and
 * `tree-operations -> reactivity` back-edges out of the graph.
 */

import type {
	ContentWrite,
	CommitMultiScopeArgs,
	LeafTextOptions,
	LeafWriteResult,
	MultiScopeTarget,
	ReplaceFocus,
	ReplaceOptions
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
	/** Write `text` as the bytes of the leaf at `leafPath` through the write a keystroke ends in: in
	 *  place while the block keeps its kind, a commit at its list otherwise. Offsets are the leaf's. */
	writeLeaf(
		leafPath: readonly number[],
		text: string,
		preEditOffset: number,
		caret: number
	): ContentWrite;
	/** Whether `writeLeaf` of `text` at `leafPath` leaves those bytes and no others. */
	landsAsWritten(leafPath: readonly number[], text: string): boolean;
	/** Replace the block at `blockPath` as one commit at its parent list, resolving to how many blocks
	 *  landed or null; `snapshotOffset` is undo's caret in the block when nothing is focused. */
	replaceBlock(
		blockPath: number[],
		replacement: CstNode[],
		focus: ReplaceFocus,
		opts: ReplaceOptions
	): Promise<number | null>;
	/** Create a paragraph holding `text` before the child `boundaryPath` names, or after the last
	 *  child when it names one past the end, as one commit at that list; caret after the text. */
	insertParagraph(boundaryPath: number[], text: string): Promise<boolean>;
}
