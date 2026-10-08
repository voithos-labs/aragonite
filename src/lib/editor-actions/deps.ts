import type { BlockComponent } from '../block-component';
import type { Document } from '../core/nodes';
import type { CaretMemory } from '../caret/caret-memory';
import type { BlockElLookup } from '../editor-keys';
import type { SelectionState } from '../selection/selection-state.svelte';
import type { UndoEntry, UndoManager } from '../undo/types';
import type { SharingState } from '../tree-operations/sharing';
import type { EditorEvents } from '../editor-events';
import type { CommitController } from '../action-contracts';
import type { Reading } from '../schema/reading';
import type { RefSlots } from '../block-lists/child-refs';
import type { CaretLanding } from '../selection/caret-landing';
import type { DocumentStamps } from './commit/document-stamp';

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
	/** Announce that the document's bytes changed. A commit calls it once; a writer outside a
	 *  commit must call it itself (G4.52). */
	bumpContentVersion(): void;
	undoManager: UndoManager;
	sharing: SharingState;
	caretMemory: CaretMemory;
	selectionState: SelectionState;
	getBlockElByPath: BlockElLookup;
	/** Where every commit's caret and every restored selection is put down, and the counter an
	 *  undo, redo or swap bumps. */
	caretLanding: CaretLanding;
	events: EditorEvents;
	/** How the editor reads its bytes: a re-parse or completer reads only the syntax it switched
	 *  on, a rewrite parses the reference links the renderer drew, a write refuses reading mode. */
	reading: Reading;
	/** Which document each write was made for: the write gate refuses one made for a document a
	 *  `source` swap replaced. */
	stamps: DocumentStamps;
}

/**
 * `CommitController` plus the members typed against `undo/`. They live here so
 * `action-contracts` keeps no import from `undo/`.
 */
export interface UndoController extends CommitController {
	/** Call a keystroke's commit into the undo entry its typing batch already holds, so a key that
	 *  reparses into several blocks undoes with the typing around it. Covers the call only. */
	joinTypingBatch<T>(write: () => T): T;
	captureCurrentState(): UndoEntry;
}

/** The editor root's deps and controller, which a write addressed by document path starts from. */
export interface EditorRoot {
	deps: EditorActionsDeps;
	controller: UndoController;
}
