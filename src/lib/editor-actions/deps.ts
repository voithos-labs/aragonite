import type { BlockComponent } from '../block-component';
import type { Document } from '../core/nodes';
import type { StickyColumnState } from '../cursor/sticky-column';
import type { EdgeAffinityState } from '../cursor/edge-affinity';
import type { BlockElLookup, PresentationModeGetter } from '../editor-keys';
import type { EditorSelection } from '../selection/primitives';
import type { SelectionState } from '../selection/selection-state.svelte';
import type { UndoEntry, UndoManager } from '../undo/types';
import type { SharingState } from '../tree-operations/sharing';
import type { EditorEvents } from '../editor-events';
import type { CommitController } from '../action-contracts';
import type { GrammarView } from '../schema/block-openers';
import type { InlineResolverRef } from '../schema/inline-construct-policy';
import type { RefSlots } from '../reactivity/publish-ref.svelte';
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
	/** The top-level scope's slot identity, so the doc-scope adapter reports the same
	 *  scope the editor's own BlockList publishes into. */
	blockRefSlots: RefSlots<BlockComponent>;
	setDoc(doc: Document): void;
	setBlockIds(ids: string[]): void;
	setBlockRefs(refs: (BlockComponent | undefined)[]): void;
	/** Announce that this door moved the document's bytes
	 *  (`reactivity/content-version.svelte.ts`). The ceremony owes one call per commit; the
	 *  writers outside it owe their own, which is the census G4.52 keeps honest. */
	bumpContentVersion(): void;
	undoManager: UndoManager;
	sharing: SharingState;
	stickyColumn: StickyColumnState;
	edgeAffinity: EdgeAffinityState;
	selectionState: SelectionState;
	getBlockElByPath: BlockElLookup;
	/** Scroll an off-window top-level block into the render window and await its
	 *  mount, then return its component (null if unreachable). Already-mounted
	 *  targets return synchronously without scrolling. */
	revealPath(path: number[]): Promise<BlockComponent | null>;
	events: EditorEvents;
	/** The instance's block grammar, so a disabled kind's opener stays skipped when
	 *  the editor re-parses an edited block. Absent = the global grammar. */
	grammar?: GrammarView;
	/** Live EFFECTIVE mode, for the seams that must not act in reading mode. Absent in
	 *  harnesses, which `isReadingMode` reads as not-reading. */
	getPresentationMode?: PresentationModeGetter;
	/** The instance's link-reference resolver, for the byte rewrites that must parse the reference
	 *  forms the render path drew. Absent in harnesses, which have no definitions to resolve. */
	linkRef?: InlineResolverRef;
}

/**
 * The two selection-typed members added to the contracts-leaf `CommitController`.
 * They stay here so that leaf keeps no edge to `selection/` or `undo/`.
 */
export interface UndoController extends CommitController {
	captureCurrentState(): UndoEntry;
	collapsedSelectionAt(blockIndex: number, offset: number): EditorSelection;
	/** Monotonic stamp of the last history swap. A caret landing captures it before its
	 *  reveal and declines when it moved: the tree it was aimed at is no longer on screen. */
	historyGeneration(): number;
	/** Announce a swap. The restore road's own call — nothing else may bump it. */
	noteHistorySwap(): void;
}
