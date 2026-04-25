/**
 * Narrow surface paste modules need from the commit/undo layer. Defining it
 * inside `tree-operations/paste/` flips the dependency direction: paste
 * declares what it needs; editor-actions supplies it. This eliminates the
 * backwards import from `tree-operations/paste/* -> editor-actions/`.
 */

import type { BlockComponent } from '../../contracts';
import type { CstNode } from '../../core/nodes';
import type { OperationKind } from '../../debug/operations-log';
import type { StructuralChange } from '../structural-change';

export interface MultiScopeTarget {
	node: CstNode;
	state: {
		innerBlockIds: string[];
		innerBlockRefs: (BlockComponent | undefined)[];
	};
}

export interface MultiScopeMutable {
	children: CstNode[];
}

export interface CommitMultiScopeArgs {
	scopes: MultiScopeTarget[];
	snapshot: { blockIndex: number; offset: number } | 'skip';
	mutate: (scopeChildren: MultiScopeMutable[]) => StructuralChange[];
	op?: { kind: OperationKind; detail?: Record<string, unknown>; eventPath: number[] };
	afterTick?: () => void;
}

export interface PasteCommitCoordinator {
	commitMultiScope(args: CommitMultiScopeArgs): Promise<void>;
	getDocScope(): MultiScopeTarget;
}
