/**
 * The copy, cut and paste steps every editable block shares, in one order no block can skip or
 * reshuffle. A block reaches them through its surface's `clipboard`, which supplies the editor's
 * half. Paste prevents the default before its first await, or the native paste runs while a shown
 * source hides. Everything goes through the event's synchronous `clipboardData`, since desktop
 * webviews gate `navigator.clipboard` reads behind a permission.
 */

import type { DocumentGetter } from '../../../editor-keys';
import type { PasteImageHook } from '../../../host-hooks';
import { emitClipboardError, type EditorEvents } from '../../../editor-events';
import type { CaretMemory } from '../../../caret/caret-memory';
import type { HeldInsertion } from '../../../caret/next-insertion';
import type { RawRange } from '../../../browser/offsets';
import { normalizeLineEndings } from '../../../core/lines';
import { escapeMarkdownLiteral } from '../../../tree-operations/paste/markdown-literal';
import type { SelectionState } from '../../../selection/selection-state.svelte';
import type { CrossBlockHandlers } from '../../../selection/cross-block/dispatch';
import { crossBlockClipboardArm } from '../../../selection/cross-block/clipboard';
import { createImagePasteArm, type ImagePasteArm } from '../../paste-image-arm';
import {
	pasteDispatch,
	type PasteDispatchContext,
	type PasteDispatchInput
} from '../../../tree-operations/paste/dispatch';
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

/**
 * The caret calls the shared clipboard code borrows from a block. `getEl` is a liveness
 * test: a host import hook can outlive the block that started the paste.
 */
export interface ClipboardCaretIO {
	getEl: () => HTMLElement | null;
	getCursorOffset: () => number | null;
	focus: (offset: number) => void;
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
	/** Reading mode: copy/cut write the visible selection string, paste is inert. */
	isReadOnly: () => boolean;
	/** The block's caret calls, borrowed by the image branch to anchor its insertion. */
	caret: ClipboardCaretIO;
	/** This editor's events: the image branch's only way to report a host hook that
	 *  rejects. Required so a block cannot silently swallow a failed import. */
	events: EditorEvents;
	/** Host image-import hook from the policies context, read at each paste. */
	onPasteImage: () => PasteImageHook | undefined;
	/** Ends the run of typing that shares one undo entry, so the next write opens its own. */
	endTypingBurst: () => void;
	/** Whether the block's own text reads Markdown; false where a paste lands byte for byte (a
	 *  code body), which plain text then needs no escape for. */
	readsMarkdown: () => boolean;
}

/** The block's half: the selections it owns and how a paste lands in its own text. */
export interface BlockClipboard {
	/** Hides a shown inline source before a cut or paste mutates, so the mutation runs against a
	 *  CST that matches the DOM. Omit on a block that never shows source. */
	foldReveal?: () => RevealFold | null;
	/** Selections tried before a range across blocks: a selected widget. */
	selectionArms?: readonly ClipboardArm[];
	/** The block's own range, tried last. */
	rangeArm: ClipboardArm;
	/** The paste step before cross-block handling, given the normalised text while a rectangle is
	 *  readable (a grid into a table's cells). True when it consumed the paste. */
	pastePreHook?: (text: string) => boolean | Promise<boolean>;
	/** The intra-block paste, handed the normalized text and where the paste goes. */
	pasteTail: (pastedText: string, target: PasteTarget) => void | Promise<void>;
}

export type ClipboardSurfaceDeps = SurfaceClipboardContext & BlockClipboard;

/** A paste into the block's own text: `pasteDispatch`'s input, less the target, which is the block. */
export type InlinePaste = Omit<PasteDispatchInput, 'targetPath'>;

/** What a paste into the block's own text reads besides the paste itself. */
export interface InlinePasteContext extends Omit<PasteDispatchContext, 'doc' | 'crossBlock'> {
	getMyPath: () => number[];
	getDoc: DocumentGetter;
	/** Puts the caret at `at` once the paste's render lands. */
	requestCaret: (at: number, opts: { source: string }) => void;
}

export async function pasteIntoBlock(ctx: InlinePasteContext, paste: InlinePaste): Promise<void> {
	const { getMyPath, getDoc, requestCaret, ...dispatch } = ctx;
	const result = await pasteDispatch(
		{ ...paste, targetPath: getMyPath() },
		{ ...dispatch, doc: getDoc() }
	);
	// Pending, so the caret set and the raw mutation land in one reactive flush.
	if (result.inlineCaretOffset !== undefined) {
		requestCaret(result.inlineCaretOffset, { source: 'clipboard' });
	}
}

/** Where a paste goes, read as its event arrives: before a shown source hides, which moves the
 *  selection, and before the paste forgets the caret memory. */
export interface PasteTarget {
	/** The selection, or the caret as an empty range; null when the block holds neither. */
	range: RawRange | null;
	/** What the caret memory kept for this block's next insertion, held until the paste ends; an
	 *  inline paste spends it. */
	held: HeldInsertion;
}

export interface ClipboardHandlers {
	onCopy(e: ClipboardEvent): void;
	onCut(e: ClipboardEvent): Promise<void>;
	onPaste(e: ClipboardEvent): Promise<void>;
	/** Insert `md` as pasting it here would, for `EditorInstance.insertMarkdown`. Resolves once
	 *  the paste lands; false in reading mode or for an empty payload. */
	insertMarkdown(md: string): Promise<boolean>;
	/** `insertMarkdown` for plain text: escaped wherever the paste lands as Markdown. */
	insertPlainText(text: string): Promise<boolean>;
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
	const arms: readonly ClipboardArm[] = [...editorSelectionArms, deps.rangeArm];
	const imageArm = createImagePasteArm({
		onPasteImage: deps.onPasteImage,
		events: deps.events,
		crossBlock: deps.crossBlock
	});

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

	/** Undo's caret, the target and what the next insertion spends, all read before the first
	 *  await: a shown source hides on the way, and its commit forgets the caret memory. */
	function readPasteTarget(): PasteTarget {
		deps.caret.recordPreEditOffset();
		return { range: deps.caret.getSelection(), held: deps.caret.holdInsertion() };
	}

	async function onPaste(e: ClipboardEvent): Promise<void> {
		e.preventDefault();
		if (deps.isReadOnly()) return;
		// Read `clipboardData` before the first await, while the event still holds it.
		const images = imageArm.filesOf(e.clipboardData);
		if (images.length === 0) {
			await pasteText(normalizeLineEndings(e.clipboardData?.getData('text/plain') ?? ''), false);
			return;
		}
		const target = readPasteTarget();
		try {
			await deps.foldReveal?.()?.settled;
			deps.caretMemory.forget();
			await pasteImages(deps, imageArm, e, images, target);
		} finally {
			target.held.finish(true);
		}
	}

	/** The paste every text payload takes, whatever brought it; `text` is already LF. `plain` text
	 *  is escaped where it lands as Markdown: across blocks, or in a block that reads Markdown. */
	async function pasteText(text: string, plain: boolean): Promise<void> {
		const asMarkdown = plain ? escapeMarkdownLiteral(text) : text;
		const asOwnText = plain && deps.readsMarkdown() ? asMarkdown : text;
		const target = readPasteTarget();
		try {
			await deps.foldReveal?.()?.settled;
			if (text && deps.pastePreHook && (await deps.pastePreHook(asOwnText))) return;
			if (await deps.crossBlock.handlePaste(null, asMarkdown)) return;
			deps.caretMemory.forget();
			// A paste that outlived its block (an unmount mid-insert) has nothing left to land in.
			if (!text || !deps.caret.getEl()) return;
			await ownUndoEntry(deps, () => deps.pasteTail(asOwnText, target));
		} finally {
			target.held.finish(true);
		}
	}

	async function insert(md: string, plain: boolean): Promise<boolean> {
		if (deps.isReadOnly()) return false;
		const text = normalizeLineEndings(md);
		if (!text) return false;
		await pasteText(text, plain);
		return true;
	}

	return {
		onCopy,
		onCut,
		onPaste,
		insertMarkdown: (md) => insert(md, false),
		insertPlainText: (text) => insert(text, true)
	};
}

/** A cut or a paste into the block's text is its own undo entry, apart from the typing on either
 *  side; one into a range or a grid commits apart already. */
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

// ── Pasting an image ────────────────────────────────────────────────────────

/** The part of an image paste that needs a caret. The target was read as the event arrived, so a
 *  slow import cannot follow a caret the user moved meanwhile. */
async function pasteImages(
	deps: ClipboardSurfaceDeps,
	imageArm: ImagePasteArm,
	e: ClipboardEvent,
	images: File[],
	target: PasteTarget
): Promise<void> {
	const anchor = target.range?.start ?? 0;
	const text = await imageArm.run(e, images);
	if (text === null) return;
	// A hook slow enough to outlive its block leaves nothing to insert into, and the
	// paste tails would fall back to offset 0. Decline, loudly.
	if (!deps.caret.getEl()) {
		emitClipboardError(deps.events, {
			error: new Error('onPasteImage resolved after its block was gone; insertion declined')
		});
		return;
	}
	// Move the caret only if it drifted: placing one collapses the DOM range the block reads its
	// replaced span from, and this paste would stop replacing the selection.
	if (deps.caret.getCursorOffset() !== anchor) deps.caret.focus(anchor);
	await ownUndoEntry(deps, () => deps.pasteTail(text, target));
}
