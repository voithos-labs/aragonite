import type { BlockComponent } from '../block-component';
import type { Document } from '../core/nodes';
import type { StickyColumnState } from '../cursor/sticky-column';
import type { BlockElLookup } from '../editor-keys';
import type { EditorSelection } from '../selection/primitives';
import type { SelectionState } from '../selection/selection-state.svelte';
import type { UndoEntry, UndoManager } from '../undo/types';
import type { SharingState } from '../tree-operations/sharing';
import type { EditorEvents } from '../editor-events';
import type { CommitController } from '../action-contracts';
import type { GrammarView } from '../schema/block-openers';
export type {
	CommitController,
	CommitStructuralArgs,
	CommitContainerStructuralArgs,
	CommitMultiScopeArgs,
	MultiScopeTarget,
	ContainerScope
} from '../action-contracts';

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
	/** Scroll an off-window top-level block into the render window and await its
	 *  mount, then return its component (null if unreachable). Already-mounted
	 *  targets return synchronously without scrolling. */
	revealPath(path: number[]): Promise<BlockComponent | null>;
	events: EditorEvents;
	/** The instance's block grammar — threaded to the content-commit
	 *  reparse so a disabled kind's opener is skipped when the editor re-parses an
	 *  edited block. Absent (bare harnesses) = the global grammar, byte-identical. */
	grammar?: GrammarView;
}

/**
 * Adds the two selection-typed members to the contracts-leaf `CommitController`.
 * They stay here (not in action-contracts) so the contracts leaf keeps no edge
 * to `selection/`/`undo/` for `EditorSelection`/`UndoEntry`.
 */
export interface UndoController extends CommitController {
	captureCurrentState(): UndoEntry;
	collapsedSelectionAt(blockIndex: number, offset: number): EditorSelection;
}
