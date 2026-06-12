/**
 * Narrow surface paste modules need from the commit/undo layer. Defining it
 * inside `tree-operations/paste/` flips the dependency direction: paste
 * declares what it needs; editor-actions supplies it. This eliminates the
 * backwards import from `tree-operations/paste/* -> editor-actions/`.
 */

import type { ContainerScope, OperationKind } from '../../action-contracts';
import type { BlockComponent } from '../../block-component';
import type { CstNode } from '../../core/nodes';
import type { SharingState } from '../../undo/sharing';
import type { StructuralChange } from '../structural-change';

export interface MultiScopeTarget {
	node: CstNode;
	state: {
		innerBlockIds: string[];
		innerBlockRefs: (BlockComponent | undefined)[];
	};
	/** Doc-absolute path of `node`; the commit primitive unshares its spine. */
	path: number[];
}

export interface CommitMultiScopeArgs<
	S extends readonly MultiScopeTarget[] = readonly MultiScopeTarget[]
> {
	scopes: S;
	snapshot: { blockIndex: number; offset: number } | 'skip';
	/** One view in, one StructuralChange out per scope, same order — tuple-checked for literal scope arrays. */
	mutate: (scopeViews: { [K in keyof S]: ContainerScope }) => {
		readonly [K in keyof S]: StructuralChange;
	};
	op?: { kind: OperationKind; detail?: Record<string, unknown>; eventPath: number[] };
	afterTick?: () => void;
}

export interface PasteCommitCoordinator {
	sharing: SharingState;
	commitMultiScope<const S extends readonly MultiScopeTarget[]>(
		args: CommitMultiScopeArgs<S>
	): Promise<void>;
	getDocScope(): MultiScopeTarget;
}
