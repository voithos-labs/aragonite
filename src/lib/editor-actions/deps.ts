import type { BlockComponent } from '../block-component';
import type { Document } from '../core/nodes';
import type { StickyColumnState } from '../cursor/sticky-column';
import type { EdgeAffinityState } from '../cursor/edge-affinity';
import type { BlockElLookup, PresentationModeGetter } from '../editor-keys';
import type { SelectionState } from '../selection/selection-state.svelte';
import type { UndoEntry, UndoManager } from '../undo/types';
import type { SharingState } from '../tree-operations/sharing';
import type { EditorEvents } from '../editor-events';
import type { CommitController } from '../action-contracts';
import type { GrammarView } from '../schema/block-openers';
import type { InlineResolverRef } from '../schema/inline-construct-policy';
import type { RefSlots } from '../reactivity/publish-ref.svelte';

export interface EditorActionsDeps {
	get doc(): Document;
	get blockIds(): string[];
	get blockRefs(): (BlockComponent | undefined)[];
	/** The root block list's ref slots, so the document-scope adapter reports the same
	 *  list the editor's own BlockList writes into. */
	blockRefSlots: RefSlots<BlockComponent>;
	setDoc(doc: Document): void;
	setBlockIds(ids: string[]): void;
	setBlockRefs(refs: (BlockComponent | undefined)[]): void;
	/** Announce that the document's bytes changed (`reactivity/content-version.svelte.ts`).
	 *  The commit sequence calls it once per commit; every writer outside a commit must call
	 *  it itself (G4.52 lists them). */
	bumpContentVersion(): void;
	undoManager: UndoManager;
	sharing: SharingState;
	stickyColumn: StickyColumnState;
	edgeAffinity: EdgeAffinityState;
	selectionState: SelectionState;
	getBlockElByPath: BlockElLookup;
	/** Scroll an unmounted top-level block into the rendered window, wait for it to mount,
	 *  and return its component (null if unreachable). An already-mounted block returns
	 *  at once without scrolling. */
	revealPath(path: number[]): Promise<BlockComponent | null>;
	events: EditorEvents;
	/** The instance's block grammar, so a disabled kind's opener stays skipped when
	 *  the editor re-parses an edited block. Absent = the global grammar. */
	grammar?: GrammarView;
	/** The live effective presentation mode, for the actions that must not write in reading
	 *  mode. Absent in harnesses, which `isReadingMode` reads as not reading. */
	getPresentationMode?: PresentationModeGetter;
	/** The instance's link-reference resolver, for byte rewrites that must parse the reference
	 *  links the renderer drew. Absent in harnesses, which have no definitions to resolve. */
	linkRef?: InlineResolverRef;
}

/**
 * `CommitController` plus the members typed against `undo/`. They live here so
 * `action-contracts` keeps no import from `undo/`.
 */
export interface UndoController extends CommitController {
	captureCurrentState(): UndoEntry;
	/** A counter bumped on every undo or redo. A caret placement reads it before scrolling its
	 *  target into view and gives up if it changed: the tree it aimed at is gone. */
	historyGeneration(): number;
	/** Announce an undo or redo. Only the history restore may call it. */
	noteHistorySwap(): void;
}
