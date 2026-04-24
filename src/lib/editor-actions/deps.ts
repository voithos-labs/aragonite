import type { Document, CstNode } from '../core/nodes';
import type {
	BlockComponent,
	BlockElLookup,
	EditorSelection,
	UndoEntry,
	UndoManager
} from '../contracts';
import type { StickyColumnState } from '../cursor/sticky-column';
import type { SelectionState } from '../selection/selection-state.svelte';
import type { OperationKind, OpDescriptor } from '../debug/operations-log';
import type { EditorEvents } from '../events/editor-events';
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
}

export interface CommitContainerStructuralArgs {
	containerNode: CstNode;
	state: {
		innerBlockIds: string[];
		innerBlockRefs: (BlockComponent | undefined)[];
	};
	snapshot: { blockIndex: number; offset: number } | 'skip';
	mutate: (children: CstNode[]) => StructuralChange;
	op?: { kind: OperationKind; detail?: Record<string, unknown>; eventPath: number[] };
	afterTick?: () => void;
}

export interface CommitMultiScopeArgs {
	scopes: MultiScopeTarget[];
	snapshot: { blockIndex: number; offset: number } | 'skip';
	mutate: (scopeChildren: MultiScopeMutable[]) => StructuralChange[];
	op?: { kind: OperationKind; detail?: Record<string, unknown>; eventPath: number[] };
	afterTick?: () => void;
}

export interface UndoController {
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
