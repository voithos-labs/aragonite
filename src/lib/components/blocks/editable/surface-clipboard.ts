/**
 * The copy and cut steps every editable block shares, in one order no block can skip or reshuffle,
 * and the block's half of a paste: what the editor root reads off the block before it pastes there.
 * A block reaches them through its surface's `clipboard`, which supplies the editor's half. A copy
 * or a cut goes through the event's synchronous `clipboardData`, since desktop webviews gate
 * `navigator.clipboard` reads behind a permission.
 */

import type { PreparedPaste } from '../../../block-component';
import type { DocumentGetter } from '../../../editor-keys';
import type { CaretMemory } from '../../../caret/caret-memory';
import type { HeldInsertion } from '../../../caret/next-insertion';
import type { RawRange } from '../../../browser/offsets';
import type { ClipboardWrite } from '../../../browser/clipboard';
import type { SelectionState } from '../../../selection/selection-state.svelte';
import type { CrossBlockHandlers } from '../../../selection/cross-block/dispatch';
import { crossBlockClipboardArm } from '../../../selection/cross-block/clipboard';
import {
	runClipboardCut,
	takeCopy,
	writeShownSelection,
	type ClipboardArm
} from './clipboard-step';

/**
 * What hiding a shown source hands back to the edit that triggered it. A commit that changes
 * the block's kind takes the structural path, whose completion is a promise, so an edit waits
 * on `settled` rather than on a tick that happens to outlast it.
 */
export interface RevealFold {
	/** The committed caret offset: where the edit left the caret. */
	caret: number;
	/** Resolves once that write has landed and its render has flushed. */
	settled: Promise<void>;
}

/** The caret reads the shared clipboard code borrows from a block. */
export interface ClipboardCaretIO {
	/** Reads the caret undo puts back after a cut or a paste, before a shown source hides. */
	recordPreEditOffset: () => void;
	/** The caret that record read. */
	getPreEditOffset: () => number;
	/** The selection, or the caret as an empty range; null when the block holds neither. */
	getSelection: () => RawRange | null;
	/** Takes what the caret memory keeps for this block's next insertion. */
	holdInsertion: () => HeldInsertion;
}

/** The editor's half of the clipboard steps, which the surface fills in for every block. */
export interface SurfaceClipboardContext {
	caretMemory: CaretMemory;
	selection: SelectionState;
	getDoc: DocumentGetter;
	crossBlock: CrossBlockHandlers;
	/** Reading mode: copy and cut write the visible selection string. */
	isReadOnly: () => boolean;
	caret: ClipboardCaretIO;
	/** Ends the run of typing that shares one undo entry, so the next write opens its own. */
	endTypingBurst: () => void;
	/** What a copy of `range` of the block's own bytes writes. */
	copyRange: (range: RawRange) => ClipboardWrite | null;
}

/** The block's half: the selections it owns and which of its bytes a paste replaces. */
export interface BlockClipboard {
	/** Hides a shown inline source before a cut or paste mutates, so the mutation runs against a
	 *  CST that matches the DOM. Omit on a block that never shows source. */
	foldReveal?: () => RevealFold | null;
	/** Selections tried before a range across blocks: a selected widget. */
	selectionArms?: readonly ClipboardArm[];
	/** Removes a cut range of the block's own bytes, the selection tried last. */
	removeRange: (range: RawRange) => void | Promise<void>;
	/** The bytes a paste replaces, given the selection read as the paste arrived; null refuses it.
	 *  `caretBefore` is undo's caret where it isn't the caret the paste found. */
	pasteRange: (selection: RawRange | null) => PasteRange | null;
}

/** `draft` takes the text itself, for a shown source the document holds only once it hides. */
export type PasteRange = RawRange & { caretBefore?: number; draft?: (text: string) => void };

export type ClipboardSurfaceDeps = SurfaceClipboardContext & BlockClipboard;

/** A block's answer to a paste as the editor's own surface makes it, every record filled. */
export interface SurfacePaste extends PreparedPaste {
	caretBefore: number;
	spend: HeldInsertion['spend'];
	finish: HeldInsertion['finish'];
}

export interface ClipboardHandlers {
	onCopy(e: ClipboardEvent): void;
	onCut(e: ClipboardEvent): Promise<void>;
	/** `BlockComponent.preparePaste` for the block. */
	preparePaste(): SurfacePaste | null;
}

export function createClipboardHandlers(deps: ClipboardSurfaceDeps): ClipboardHandlers {
	// The selections the editor holds itself, which copy the same in every mode.
	const editorSelectionArms: readonly ClipboardArm[] = [
		...(deps.selectionArms ?? []),
		crossBlockClipboardArm({
			selection: deps.selection,
			getDoc: deps.getDoc,
			crossBlock: deps.crossBlock
		})
	];
	const rangeArm: ClipboardArm<RawRange> = {
		copy: () => {
			const range = deps.caret.getSelection();
			const write = range && range.start < range.end ? deps.copyRange(range) : null;
			return write && range && { write, held: range };
		},
		remove: deps.removeRange
	};
	const arms: readonly ClipboardArm[] = [...editorSelectionArms, rangeArm];

	function onCopy(e: ClipboardEvent): void {
		deps.caretMemory.forget();
		e.preventDefault();
		// A range inside one block copies what the user sees in reading mode, as does a copy no
		// `ClipboardArm` takes.
		if (takeCopy(e, deps.isReadOnly() ? editorSelectionArms : arms) === null)
			writeShownSelection(e);
	}

	function onCut(e: ClipboardEvent): Promise<void> {
		if (deps.isReadOnly()) {
			onCopy(e);
			return Promise.resolve();
		}
		deps.caretMemory.forget();
		deps.caret.recordPreEditOffset();
		return ownUndoEntry(deps, () => runClipboardCut(e, arms, deps.foldReveal));
	}

	/** Undo's caret, the range and what the next insertion spends are read before the shown source
	 *  hides: hiding moves the selection, and its commit forgets the caret memory. */
	function preparePaste(): SurfacePaste | null {
		deps.caret.recordPreEditOffset();
		const selection = deps.caret.getSelection();
		const held = deps.caret.holdInsertion();
		const settled = deps.foldReveal?.()?.settled;
		const range = deps.pasteRange(selection);
		deps.caretMemory.forget();
		if (!range) {
			held.finish(false);
			return null;
		}
		return {
			start: range.start,
			end: range.end,
			settled,
			draft: range.draft,
			caretBefore: range.caretBefore ?? deps.caret.getPreEditOffset(),
			spend: held.spend,
			finish: held.finish
		};
	}

	return { onCopy, onCut, preparePaste };
}

/** A cut from the block's text is its own undo entry, apart from the typing on either side; one
 *  from a range across blocks commits apart already. */
async function ownUndoEntry(
	deps: Pick<SurfaceClipboardContext, 'endTypingBurst'>,
	edit: () => void | Promise<void>
): Promise<void> {
	deps.endTypingBurst();
	try {
		await edit();
	} finally {
		deps.endTypingBurst();
	}
}
