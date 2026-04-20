/**
 * Shared dependency + controller types for the editor-actions factories.
 */

import type { Document, CstNode } from '../../core/nodes';
import type {
	BlockComponent,
	BlockElLookup,
	EditorSelection,
	UndoEntry,
	UndoManager
} from '../../contracts';
import type { StickyColumnState } from '../../contenteditable/sticky-column';
import type { SelectionState } from '../../selection/selection-state.svelte';
import type { OperationKind, OpDescriptor } from '../../debug/operations-log';
import type { EditorEvents } from '../../events/editor-events';

export interface EditorActionsDeps {
	// Reactive state — getters read the live value from Svelte's $state.
	get doc(): Document;
	get blockIds(): string[];
	get blockRefs(): (BlockComponent | undefined)[];
	// Setters for reassignment from inside factories.
	setDoc(doc: Document): void;
	setBlockIds(ids: string[]): void;
	setBlockRefs(refs: (BlockComponent | undefined)[]): void;
	// Services.
	undoManager: UndoManager;
	stickyColumn: StickyColumnState;
	selectionState: SelectionState;
	getBlockElByPath: BlockElLookup;
	events: EditorEvents;
}

export interface UndoController {
	pushUndoSnapshot(blockIndex: number, offset: number): void;
	pushUndoSnapshotDebounced(blockIndex: number, offset: number): void;
	commitStructural(
		snapshotBlockIndex: number,
		snapshotOffset: number,
		mutate: (children: CstNode[], ids: string[], refs: (BlockComponent | undefined)[]) => void,
		afterTick?: () => void,
		options?: {
			skipSnapshot?: boolean;
			op?: OpDescriptor;
		}
	): Promise<void>;
	commitContainerStructural(
		containerNode: CstNode,
		state: {
			innerBlockIds: string[];
			innerBlockRefs: (BlockComponent | undefined)[];
		},
		snapshot: { blockIndex: number; offset: number } | 'skip',
		mutate: (children: CstNode[], ids: string[], refs: (BlockComponent | undefined)[]) => void,
		afterTick?: () => void,
		op?: {
			kind: OperationKind;
			detail?: Record<string, unknown>;
			eventPath: number[];
		}
	): Promise<void>;
	captureCurrentState(): UndoEntry;
	collapsedSelectionAt(blockIndex: number, offset: number): EditorSelection;
	/** Clear the pending keystroke-debounce timer + force the next edit to start a new batch. */
	clearDebouncedCheckpoint(): void;
}
