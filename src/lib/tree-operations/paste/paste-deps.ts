/**
 * Narrow surface paste modules need from the commit/undo layer. Defining it
 * inside `tree-operations/paste/` flips the dependency direction: paste
 * declares what it needs; editor-actions supplies it. This eliminates the
 * backwards import from `tree-operations/paste/* -> editor-actions/`.
 */

import type { OperationKind } from '../../action-contracts';
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

/** Owned scope view — mutate through `node`/`children`, never pre-commit captures. */
export interface MultiScopeMutable {
	children: CstNode[];
	node: CstNode;
}

export interface CommitMultiScopeArgs {
	scopes: MultiScopeTarget[];
	snapshot: { blockIndex: number; offset: number } | 'skip';
	mutate: (scopeChildren: MultiScopeMutable[], sharing: SharingState) => StructuralChange[];
	op?: { kind: OperationKind; detail?: Record<string, unknown>; eventPath: number[] };
	afterTick?: () => void;
}

export interface PasteCommitCoordinator {
	sharing: SharingState;
	commitMultiScope(args: CommitMultiScopeArgs): Promise<void>;
	getDocScope(): MultiScopeTarget;
}
