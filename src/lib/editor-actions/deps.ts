import type { OpDescriptor, OperationKind } from '../action-contracts';
import type { BlockComponent } from '../block-component';
import type { CstNode, Document } from '../core/nodes';
import type { StickyColumnState } from '../cursor/sticky-column';
import type { BlockElLookup, EditorSelection } from '../editor-keys';
import type { SelectionState } from '../selection/selection-state.svelte';
import type { UndoEntry, UndoManager } from '../undo/types';
import type { SharingState } from '../undo/sharing';
import type { EditorEvents } from '../editor-events';
import type { StructuralChange } from '../tree-operations/structural-change';
import type { MultiScopeTarget, MultiScopeMutable } from './undo-controller';
export type { MultiScopeTarget, MultiScopeMutable };

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

/**
 * Owned mutation view handed to a container commit's `mutate`. `node` is the
 * unshared copy already spliced into the live tree with `children` attached —
 * never write through references captured before the commit; they may be
 * stale snapshot-shared originals.
 */
export interface ContainerScope {
	node: CstNode;
	children: CstNode[];
	sharing: SharingState;
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
	op?: { kind: OperationKind; detail?: Record<string, unknown>; eventPath: number[] };
	afterTick?: () => void;
}

export interface CommitMultiScopeArgs {
	scopes: MultiScopeTarget[];
	snapshot: { blockIndex: number; offset: number } | 'skip';
	mutate: (scopeChildren: MultiScopeMutable[], sharing: SharingState) => StructuralChange[];
	op?: { kind: OperationKind; detail?: Record<string, unknown>; eventPath: number[] };
	afterTick?: () => void;
}

export interface UndoController {
	/** Editor's sharing epoch state, exposed for out-of-ceremony copy-path-on-write. */
	sharing: SharingState;
	pushUndoSnapshot(blockIndex: number, offset: number): void;
	pushUndoSnapshotDebounced(blockIndex: number, offset: number, batchKey?: string | number): void;
	commitStructural(args: CommitStructuralArgs): Promise<void>;
	commitContainerStructural(args: CommitContainerStructuralArgs): Promise<void>;
	commitMultiScope(args: CommitMultiScopeArgs): Promise<void>;
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
