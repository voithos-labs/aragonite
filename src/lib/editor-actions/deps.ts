import type { BlockComponent } from '../block-component';
import type { Document } from '../core/nodes';
import type { CaretMemory } from '../cursor/caret-memory';
import type { BlockElLookup } from '../editor-keys';
import type { SelectionState } from '../selection/selection-state.svelte';
import type { EditorSelection } from '../selection/primitives';
import type { UndoEntry, UndoManager } from '../undo/types';
import type { SharingState } from '../tree-operations/sharing';
import type { EditorEvents } from '../editor-events';
import type { CommitController } from '../action-contracts';
import type { Reading } from '../schema/reading';
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
	caretMemory: CaretMemory;
	selectionState: SelectionState;
	/** The edge of the image selected whole, as a collapsed caret, or null with none selected:
	 *  no block reports a caret meanwhile, so every live selection read answers with this one.
	 *  Absent in harnesses. */
	getSelectedWidgetCaret?: () => EditorSelection | null;
	getBlockElByPath: BlockElLookup;
	/** Scroll an unmounted top-level block into the rendered window, wait for it to mount,
	 *  and return its component (null if unreachable). An already-mounted block returns
	 *  at once without scrolling. */
	revealPath(path: number[]): Promise<BlockComponent | null>;
	events: EditorEvents;
	/** How the editor reads its bytes: a re-parse or completer reads only the syntax it switched
	 *  on, a rewrite parses the reference links the renderer drew, a write refuses reading mode. */
	reading: Reading;
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
