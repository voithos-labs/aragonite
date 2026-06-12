import type { ContainerScope } from '../action-contracts';
import type { OpDescriptor, ScopedOpDescriptor } from '../schema/operations';
import type { BlockComponent } from '../block-component';
import type { CstNode, Document } from '../core/nodes';
import type { StickyColumnState } from '../cursor/sticky-column';
import type { BlockElLookup, EditorSelection } from '../editor-keys';
import type { SelectionState } from '../selection/selection-state.svelte';
import type { UndoEntry, UndoManager } from '../undo/types';
import type { SharingState } from '../undo/sharing';
import type { EditorEvents } from '../editor-events';
import type { StructuralChange } from '../tree-operations/structural-change';
import type { MultiScopeTarget } from './undo-controller';
export type { MultiScopeTarget };
export type { ContainerScope } from '../action-contracts';

export interface EditorActionsDeps {
	get doc(): Document;
	get blockIds(): string[];
	get blockRefs(): (BlockComponent | undefined)[];
	setDoc(doc: Document): void;
	setBlockIds(ids: string[]): void;
	setBlockRefs(refs: (BlockComponent | undefined)[]): void;
	undoManager: UndoManager;
	sharing: SharingState;
	stickyColumn: StickyColumnState;
	selectionState: SelectionState;
	getBlockElByPath: BlockElLookup;
	events: EditorEvents;
}

export interface CommitStructuralArgs {
	snapshot: { blockIndex: number; offset: number } | 'skip';
	mutate: (children: CstNode[]) => StructuralChange;
	op?: OpDescriptor;
	afterTick?: () => void;
	/** Leaf(ves) for the dev invariant check when `mutate` returns `noop` (in-place kind change). */
	touchedNodes?: CstNode[];
}

export interface CommitContainerStructuralArgs {
	containerNode: CstNode;
	/** Doc-absolute path of `containerNode` — the spine the primitive unshares + rebuilds. */
	path: number[];
	state: {
		innerBlockIds: string[];
		innerBlockRefs: (BlockComponent | undefined)[];
	};
	snapshot: { blockIndex: number; offset: number } | 'skip';
	mutate: (scope: ContainerScope) => StructuralChange;
	op?: ScopedOpDescriptor;
	afterTick?: () => void;
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
	op?: ScopedOpDescriptor;
	afterTick?: () => void;
}

export interface UndoController {
	/** Editor's sharing epoch state, exposed for out-of-ceremony copy-path-on-write. */
	sharing: SharingState;
	pushUndoSnapshot(blockIndex: number, offset: number): void;
	pushUndoSnapshotDebounced(blockIndex: number, offset: number, batchKey?: string | number): void;
	commitStructural(args: CommitStructuralArgs): Promise<void>;
	commitContainerStructural(args: CommitContainerStructuralArgs): Promise<void>;
	commitMultiScope<const S extends readonly MultiScopeTarget[]>(
		args: CommitMultiScopeArgs<S>
	): Promise<void>;
	/**
	 * Expose the document root as a MultiScopeTarget so commitMultiScope
	 * callers can include doc-level splices alongside container scopes
	 * (e.g., a cross-block delete whose LCA is the document root).
	 */
	getDocScope(): MultiScopeTarget;
	captureCurrentState(): UndoEntry;
	collapsedSelectionAt(blockIndex: number, offset: number): EditorSelection;
	/** Clear the pending keystroke-debounce timer; next edit starts a new batch. */
	clearDebouncedCheckpoint(): void;
}
