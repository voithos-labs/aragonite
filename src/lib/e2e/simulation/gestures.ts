import type { Rng } from './rng';
import { type SimContext, assertFocusBlock, settleTypedSource } from './invariants';
import {
	applyBold,
	applyItalic,
	copySelection,
	pasteHere,
	selectAndDelete,
	selectChars
} from './gestures/selection';
import {
	continueQuote,
	hardBreakAt,
	indent,
	indentEmptyItem,
	mintAtGap,
	nestQuote,
	outdent,
	outdentEmptyItem,
	reorder,
	reorderInContainer,
	softEnter,
	startQuote,
	toggleTask,
	toggleTaskByKeyboard,
	typeFreshItem,
	typeFenceOpener,
	exitFence
} from './gestures/structure';
import { insertImage, resizeImage } from './gestures/image';
import {
	backspaceRevealEditInlineMath,
	deleteAcrossMathFence,
	deleteAroundInlineMath,
	deleteInlineMathWidget,
	editBlockMath,
	editInlineMath,
	insertBlockMath,
	insertInlineMath,
	reorderPastMathFence,
	walkThroughInlineMath
} from './gestures/math';
import {
	deleteColumn,
	deleteRow,
	editCell,
	insertColumnRight,
	insertRowBelow
} from './gestures/table';
import {
	arrowFocusMermaid,
	backspaceTwoStepDeleteUndoMermaid,
	enterBelowUndoMermaid
} from './gestures/mermaid';
import {
	pasteGithubAlert,
	publishDocStats,
	setCalloutKind,
	toggleCollapse
} from './gestures/plugin';
import {
	editContainerBody,
	editLeafInfo,
	insertLeafDirective,
	insertTextDirective,
	leafBackspaceAtStart,
	revealEditTextDirective
} from './gestures/directive';
import {
	deleteFootnoteReference,
	editFootnoteLabel,
	footnoteDefinitionExitBackspace,
	revealFootnoteReference,
	splitFootnoteDefinitionBody,
	typeFootnoteDefinition,
	typeFootnoteReference
} from './gestures/footnote';
import { lateCorrection } from './gestures/correction';
import { flipPresentationMode } from './gestures/presentation';
import {
	liveDemoteHeading,
	liveEdgeBackspace,
	liveExtendIntoTablePark,
	liveLinkCardEdit,
	liveListHomeSeat,
	liveMergeLanding,
	liveSplitInsideConstruct,
	liveToggleFormat,
	liveTypeFenceOpener,
	liveTypeHeadingOpener,
	liveTypeTableOpener,
	type LiveFormat
} from './gestures/live-editing';
import {
	cutSelection,
	deleteSelection,
	extendSelectionAcross,
	pasteOverSelection,
	selectWholeDocument,
	shiftClickAcross,
	typeOverSelection
} from './gestures/cross-block';
import { mergeBackspaceAtStart } from './gestures/merge';
import { type RangeInterruptGesture, rangeInterrupt } from './gestures/range-interrupt';
import {
	backspaceThroughWidgetIsland,
	edgeDeleteReplaceIsland,
	reorderDecoratedBlock,
	typeAdjacentToIsland,
	walkAcrossIsland
} from './gestures/decoration';
import { atomicDeleteEntityWidget, typeEntityWidget } from './gestures/entity';
import { atomicDeleteEmoji, stepOverEmoji, typeEmojiShortcode } from './gestures/emoji';
import {
	mergeGithubAlertMiddleChild,
	reorderGithubAlertBodyChild,
	typeGithubAlert,
	unwrapGithubAlert
} from './gestures/github-alert';
import { composeAbort, composeCommit, type CompositionCase } from './gestures/ime';
import { slashInsert } from './gestures/slash';

/**
 * The vocabulary of human gestures on top of EditorPage. Each gesture makes a real keyboard or
 * mouse action, then either predicts the bytes (printable typing) or resyncs the expected answer
 * (anything automatic), and waits on something observable rather than sleeping. The set of
 * methods is fixed: a new gesture is a new method, so a note fixture is never rewritten.
 */
export interface GestureOpts {
	typoRate?: number;
	onCheckpoint?: (label: string, gesture: string) => Promise<void>;
}

export class Gestures {
	private readonly typoRate: number;
	private readonly onCheckpoint?: (label: string, gesture: string) => Promise<void>;
	/** Set by a gesture that leaves the caret somewhere other than the document end. */
	private caretParkedMidBlock = false;

	constructor(
		private readonly ctx: SimContext,
		private readonly rng: Rng,
		opts: GestureOpts = {}
	) {
		this.typoRate = opts.typoRate ?? 0;
		this.onCheckpoint = opts.onCheckpoint;
	}

	/**
	 * Marks a point in the build for the recorder. Does nothing unless the capture run supplied
	 * a callback, so it changes no state and cannot affect a replay.
	 */
	async checkpoint(label: string, gesture: string): Promise<void> {
		await this.onCheckpoint?.(label, gesture);
	}

	// ── Typing ────────────────────────────────────────────────────────────────

	async typeText(text: string): Promise<void> {
		const { editor, tracker } = this.ctx;
		// The expected answer assumes typing at the document end, so a caret left mid-block
		// would show up as a source mismatch blaming the wrong thing. Fail at the real cause.
		if (this.caretParkedMidBlock) {
			throw new Error(
				`[${this.ctx.label}] typeText after hardBreakAt or mintAtGap: the caret sits ` +
					`mid-document, which the tracker's document-end model cannot predict. Both must ` +
					`be a note's last build gesture.`
			);
		}
		for (const ch of text) {
			if (this.typoRate > 0 && isLetter(ch) && this.rng.chance(this.typoRate)) {
				await this.injectCancellingTypo(ch);
			}
			await editor.typeSlowly(ch);
			await settleTypedSource(this.ctx, tracker.appendChar(ch));
		}
	}

	/**
	 * Type the first line of a new list item: the first character resyncs, because the marker
	 * appears with it, and the rest is predicted. Nests deeper than `typeText` can.
	 */
	typeFreshItem(text: string): Promise<void> {
		return typeFreshItem(this.ctx, text);
	}

	// ── Navigation / repositioning ──────────────────────────────────────────────

	/**
	 * A real click to move the caret, checking where it ended up: a click that lands in the wrong
	 * block must never be recorded as if it were right. The block path is what is checked; the
	 * offset resyncs to whatever the click produced. An exact offset or a nested block goes
	 * through `editor.clickBlockAtPath`.
	 */
	async clickToReposition(targetBlockPath: number[]): Promise<void> {
		const { editor, tracker } = this.ctx;
		await editor.clickBlock(targetBlockPath[0]);
		await editor.waitForRenderFlush();
		await assertFocusBlock(this.ctx, targetBlockPath);
		tracker.resync(await editor.bridge.getSource());
	}

	/**
	 * Imitates noticing an earlier typo and going back to fix it. Leaves the bytes as they were,
	 * so the end state still matches.
	 */
	lateCorrection(targetBlockPath: number[]): Promise<void> {
		return lateCorrection(this.ctx, this, targetBlockPath);
	}

	// ── Structure ───────────────────────────────────────────────────────────────

	/** Enter splits a block; the empty block it leaves is automatic, so resync. */
	async pressEnter(): Promise<void> {
		const { page, editor, tracker } = this.ctx;
		const hostsBefore = await page.evaluate(() => document.querySelectorAll('.block-host').length);
		await page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(hostsBefore + 1);
		tracker.resync(await editor.bridge.getSource());
	}

	// ── Delegators ──────────────────────────────────────────────────────────────
	// A thin front for gestures/. Those take SimContext directly, so each can be called on its
	// own and this file stays small as the method list grows.

	/** Extend a selection `count` chars from the caret (leftward; negative = rightward). */
	selectChars(count: number): Promise<void> {
		return selectChars(this.ctx, count);
	}

	selectAndDelete(count: number): Promise<void> {
		return selectAndDelete(this.ctx, count);
	}

	copySelection(): Promise<void> {
		return copySelection(this.ctx);
	}

	pasteHere(): Promise<void> {
		return pasteHere(this.ctx);
	}

	applyBold(): Promise<void> {
		return applyBold(this.ctx);
	}

	applyItalic(): Promise<void> {
		return applyItalic(this.ctx);
	}

	softEnter(): Promise<void> {
		return softEnter(this.ctx);
	}

	/** ``` at the document end: the fence completes itself, and its closing line is held past
	 *  the caret. */
	typeFenceOpener(): Promise<void> {
		return typeFenceOpener(this.ctx);
	}

	/** Enter on the fence's empty last line leaves the block. */
	exitFence(): Promise<void> {
		return exitFence(this.ctx);
	}

	async hardBreakAt(blockPath: number[], offset: number): Promise<void> {
		await hardBreakAt(this.ctx, blockPath, offset);
		this.caretParkedMidBlock = true;
	}

	indent(): Promise<void> {
		return indent(this.ctx);
	}

	/**
	 * The `pressEnter`, `indentEmptyItem`, `typeFreshItem` sequence nests deeper than indenting
	 * an item that already has text, which stops at two levels.
	 */
	indentEmptyItem(): Promise<void> {
		return indentEmptyItem(this.ctx);
	}

	outdent(): Promise<void> {
		return outdent(this.ctx);
	}

	/** Move the top-level block at `blockIndex` up (dir -1) or down (dir 1) via Alt+Arrow. */
	reorder(blockIndex: number, dir: -1 | 1): Promise<void> {
		return reorder(this.ctx, blockIndex, dir);
	}

	/**
	 * The edge of an opaque container refuses the move, so this changes no bytes; if the block
	 * ever jumped out of the container again, the source would change and this would throw.
	 */
	reorderInContainer(bodyPath: number[]): Promise<void> {
		return reorderInContainer(this.ctx, bodyPath);
	}

	/**
	 * The opposite of `indentEmptyItem`. Waits for the focused item's path to get shorter; the
	 * next `typeFreshItem` brings its marker back.
	 */
	outdentEmptyItem(): Promise<void> {
		return outdentEmptyItem(this.ctx);
	}

	startQuote(text: string): Promise<void> {
		return startQuote(this.ctx, text);
	}

	/** Needs the slash-commands plugin: `/test/editor?slash=on`. */
	slashInsert(query: string, inserted: string, text: string): Promise<void> {
		return slashInsert(this.ctx, query, inserted, text);
	}

	continueQuote(text: string): Promise<void> {
		return continueQuote(this.ctx, text);
	}

	/** Types a `> >` nested quote, so the end-state check covers leaving a nested quote. */
	nestQuote(text: string): Promise<void> {
		return nestQuote(this.ctx, text);
	}

	toggleTask(listItemPath: number[]): Promise<void> {
		return toggleTask(this.ctx, listItemPath);
	}

	/** Mod+Enter with the caret in the item, the path a keyboard user takes to the box. */
	toggleTaskByKeyboard(itemParagraphPath: number[]): Promise<void> {
		return toggleTaskByKeyboard(this.ctx, itemParagraphPath);
	}

	/**
	 * Insert a paragraph at the caret between blocks, before `boundaryIndex`: the one insert no
	 * other gesture reaches, since that gap belongs to no block's editable area. Empty `text`
	 * presses Enter. Leaves the caret mid-document, so it must be a note's last gesture.
	 */
	async mintAtGap(
		boundaryIndex: number,
		text: string,
		options?: { arrival?: 'backspace' | 'arrow-up' }
	): Promise<void> {
		await mintAtGap(this.ctx, boundaryIndex, text, options);
		this.caretParkedMidBlock = true;
	}

	insertImage(alt: string, url: string): Promise<void> {
		return insertImage(this.ctx, alt, url);
	}

	resizeImage(direction: 'left' | 'right', steps: number): Promise<void> {
		return resizeImage(this.ctx, direction, steps);
	}

	// ── Math (LaTeX extension, plugins route) ───────────────────────────────────
	// Insert, edit and delete inline `$…$` and block `$$…$$` math. Each gesture waits for the
	// swap between the widget and its source, and resyncs once the reparse is done.

	insertInlineMath(formula: string): Promise<void> {
		return insertInlineMath(this.ctx, formula);
	}

	insertBlockMath(formula: string, blurBlockIndex: number): Promise<void> {
		return insertBlockMath(this.ctx, formula, blurBlockIndex);
	}

	editInlineMath(text: string): Promise<void> {
		return editInlineMath(this.ctx, text);
	}

	editBlockMath(text: string, blurBlockIndex: number): Promise<void> {
		return editBlockMath(this.ctx, text, blurBlockIndex);
	}

	deleteAroundInlineMath(blockIndex: number): Promise<void> {
		return deleteAroundInlineMath(this.ctx, blockIndex);
	}

	deleteInlineMathWidget(blockIndex: number): Promise<void> {
		return deleteInlineMathWidget(this.ctx, blockIndex);
	}

	/** Arrow into an inline widget at the end of a block, walk through the source it shows and
	 *  out the front of it, and let it close again: the bytes must come back identical. */
	walkThroughInlineMath(blockIndex: number): Promise<void> {
		return walkThroughInlineMath(this.ctx, blockIndex);
	}

	/** Backspace into an inline widget at the end of a block, type inside the formula, and
	 *  commit it by moving the caret out past its end. */
	backspaceRevealEditInlineMath(blockIndex: number, insert: string): Promise<void> {
		return backspaceRevealEditInlineMath(this.ctx, blockIndex, insert);
	}

	// Both fence gestures work from a prose block beside the fence and never focus the fence
	// itself, which would show its source on pointerdown.

	/** Alt+Arrow the prose above the fence past it and back: the bytes end up as they were, and
	 *  the fence's raw text and kind must survive unchanged. */
	reorderPastMathFence(proseIndex: number, fenceIndex: number): Promise<void> {
		return reorderPastMathFence(this.ctx, proseIndex, fenceIndex);
	}

	/** Backspace a range running from the prose above to the prose below, so the fence lies
	 *  entirely inside it: every fence byte must go, and one undo must bring it back. */
	deleteAcrossMathFence(fenceIndex: number): Promise<void> {
		return deleteAcrossMathFence(this.ctx, this, fenceIndex);
	}

	// ── Mermaid (whole-block focus, plugins route) ──────────────────────────────
	// An opaque diagram with no children: each gesture waits for a focus or structural change
	// and resyncs, and the delete and Enter detours end with an undo, so the bytes come back.

	arrowFocusMermaid(belowIndex: number): Promise<void> {
		return arrowFocusMermaid(this.ctx, belowIndex);
	}

	enterBelowUndoMermaid(): Promise<void> {
		return enterBelowUndoMermaid(this.ctx);
	}

	backspaceTwoStepDeleteUndoMermaid(belowIndex: number): Promise<void> {
		return backspaceTwoStepDeleteUndoMermaid(this.ctx, belowIndex);
	}

	// ── Table ─────────────────────────────────────────────────────────────────
	// Each resyncs, because the table pads its cells to a standard width. A cell is named by
	// its rendered index, counting across rows, which shifts after an insert or delete, so the
	// caller works from the grid as it stands.

	editCell(cellIndex: number, text: string): Promise<void> {
		return editCell(this.ctx, cellIndex, text);
	}

	insertColumnRight(cellIndex: number): Promise<void> {
		return insertColumnRight(this.ctx, cellIndex);
	}

	deleteColumn(cellIndex: number): Promise<void> {
		return deleteColumn(this.ctx, cellIndex);
	}

	insertRowBelow(cellIndex: number): Promise<void> {
		return insertRowBelow(this.ctx, cellIndex);
	}

	deleteRow(cellIndex: number): Promise<void> {
		return deleteRow(this.ctx, cellIndex);
	}

	// ── Plugin containers ───────────────────────────────────────────────────────
	// Each resyncs, since the opening line is rewritten and the body mounts or unmounts. Only
	// reachable on a loaded document that already holds a details container.

	toggleCollapse(): Promise<void> {
		return toggleCollapse(this.ctx);
	}

	// A plugin command whose shortcut travels from a callout child up to the container's
	// handler. Resyncs, since the opening line is rewritten; needs a loaded `:::callout`.
	setCalloutKind(): Promise<void> {
		return setCalloutKind(this.ctx);
	}

	// A real paste (Mod+V) of a GitHub alert, which the admonitions plugin rewrites to a
	// :::tip before parsing. Resyncs, since both the rewrite and the reparse change the bytes.
	pasteGithubAlert(): Promise<void> {
		return pasteGithubAlert(this.ctx);
	}

	// A global shortcut that only reads: it rewrites `window.__docStats` and commits nothing, so
	// the bytes are unchanged. Needs the doc-stats plugin installed.
	publishDocStats(): Promise<void> {
		return publishDocStats(this.ctx);
	}

	// ── Directives (`:::name` primitive, plugins route) ──────────────────────────
	// Each waits for the block to change kind or for the widget to swap in, then resyncs after
	// the reparse. A container is inserted by pasting: typing one block at a time never builds
	// a multi-line fence.

	insertTextDirective(name: string, label: string): Promise<void> {
		return insertTextDirective(this.ctx, name, label);
	}

	revealEditTextDirective(stepIn: number, text: string, blurBlockIndex: number): Promise<void> {
		return revealEditTextDirective(this.ctx, stepIn, text, blurBlockIndex);
	}

	insertLeafDirective(name: string, info: string): Promise<void> {
		return insertLeafDirective(this.ctx, name, info);
	}

	editLeafInfo(leafIndex: number, text: string): Promise<void> {
		return editLeafInfo(this.ctx, leafIndex, text);
	}

	leafBackspaceAtStart(leafIndex: number): Promise<void> {
		return leafBackspaceAtStart(this.ctx, leafIndex);
	}

	editContainerBody(bodyPath: number[], text: string): Promise<void> {
		return editContainerBody(this.ctx, bodyPath, text);
	}

	// ── Footnotes (first-party plugin, `?seed=footnotes`) ────────────────────────
	// Two parts: the `[^label]: ` definition block and the `[^label]` inline reference widget.
	// Everything here resyncs, because the reference number is worked out for display and the
	// expected answer never models it.

	typeFootnoteDefinition(targetIndex: number, label: string, body: string): Promise<void> {
		return typeFootnoteDefinition(this.ctx, targetIndex, label, body);
	}

	splitFootnoteDefinitionBody(bodyPath: number[]): Promise<void> {
		return splitFootnoteDefinitionBody(this.ctx, bodyPath);
	}

	footnoteDefinitionExitBackspace(bodyPath: number[]): Promise<void> {
		return footnoteDefinitionExitBackspace(this.ctx, bodyPath);
	}

	typeFootnoteReference(label: string): Promise<void> {
		return typeFootnoteReference(this.ctx, label);
	}

	revealFootnoteReference(refIndex: number, blurBlockIndex: number): Promise<void> {
		return revealFootnoteReference(this.ctx, refIndex, blurBlockIndex);
	}

	editFootnoteLabel(refIndex: number, text: string, blurBlockIndex: number): Promise<void> {
		return editFootnoteLabel(this.ctx, refIndex, text, blurBlockIndex);
	}

	deleteFootnoteReference(refIndex: number, blurBlockIndex: number): Promise<void> {
		return deleteFootnoteReference(this.ctx, refIndex, blurBlockIndex);
	}

	// ── Cross-block selection and deletion ───────────────────────────────────────
	// Building a range throws loudly if it never engaged; deleting one waits for the collapse,
	// runs the structural checks on the merged tree, and resyncs. The caller closes with an
	// undo, since deleting across blocks must be reversible byte for byte.

	/** Extend the selection past the block below or above the caret with Shift+Arrow. */
	extendSelectionAcross(dir: 'down' | 'up', maxSteps?: number): Promise<void> {
		return extendSelectionAcross(this.ctx, dir, maxSteps);
	}

	shiftClickAcross(targetPath: number[], offset: number): Promise<void> {
		return shiftClickAcross(this.ctx, targetPath, offset);
	}

	/** Ctrl+A twice: select the caret's block, then widen to the whole document. */
	selectWholeDocument(): Promise<void> {
		return selectWholeDocument(this.ctx);
	}

	deleteSelection(key: 'Backspace' | 'Delete'): Promise<void> {
		return deleteSelection(this.ctx, key);
	}

	cutSelection(): Promise<void> {
		return cutSelection(this.ctx);
	}

	typeOverSelection(text: string): Promise<void> {
		return typeOverSelection(this.ctx, text);
	}

	pasteOverSelection(): Promise<void> {
		return pasteOverSelection(this.ctx);
	}

	// ── Block merge ───────────────────────────────────────────────────────────────

	/**
	 * Backspace at the start of a block: it merges into the block above, or leaves the container
	 * it sits in. Throws loudly if nothing happens (the first block has nothing above it), runs
	 * the structural checks, and resyncs; the caller closes with an undo.
	 */
	mergeBackspaceAtStart(targetPath: number[]): Promise<void> {
		return mergeBackspaceAtStart(this.ctx, targetPath);
	}

	// ── Range interrupt ───────────────────────────────────────────────────────────

	/**
	 * Run `gesture` while a cross-block range is live, then press one printable key, and check
	 * the bytes against the outcome that gesture is held to. This is the situation that hid two
	 * whole documents being lost. The outcomes are listed in `gestures/range-interrupt.ts`.
	 */
	rangeInterrupt(gesture: RangeInterruptGesture): Promise<void> {
		return rangeInterrupt(this.ctx, this, gesture);
	}

	// ── History ───────────────────────────────────────────────────────────────

	/**
	 * Flush the input batcher so the next gesture starts a new undo entry; without it the
	 * batcher groups keystrokes within about 250ms into one. A fixed step, not a wait on the
	 * clock.
	 */
	pause(): Promise<void> {
		return this.ctx.editor.waitForUndoBatchFlush();
	}

	async undo(): Promise<void> {
		await this.ctx.editor.undo();
		this.ctx.tracker.resync(await this.ctx.editor.bridge.getSource());
	}

	async redo(): Promise<void> {
		await this.ctx.editor.redo();
		this.ctx.tracker.resync(await this.ctx.editor.bridge.getSource());
	}

	// ── Presentation ────────────────────────────────────────────────────────────

	/**
	 * Switch to `mode` and back mid-session, checking that the note comes back byte for byte.
	 * The switch is automatic, so it waits on the mode attribute and resyncs. Nothing else in
	 * the loaded-document suites checks that the bytes survive a mode switch.
	 */
	flipPresentationMode(
		mode: 'reading' | 'preview-block' | 'preview-inline' | 'live'
	): Promise<void> {
		return flipPresentationMode(this.ctx, mode);
	}

	// ── Live-mode editing ───────────────────────────────────────────────────────
	// Each switches into live mode through the toggle, drives one live-only rule, and undoes
	// what it wrote, so the bytes end up as they were and a note can run it mid-session.

	/** Toggle a mark over a selected word; `strikethrough` and `inlineCode` are the two
	 *  shortcuts live mode adds, and all three write bytes at once over a range. */
	liveToggleFormat(blockIndex: number, word: string, format: LiveFormat): Promise<void> {
		return liveToggleFormat(this.ctx, blockIndex, word, format);
	}

	/** Backspace at the end of a construct's text takes the visible character, not the
	 *  delimiter the browser's own editing would have reached. */
	liveEdgeBackspace(blockIndex: number, content: string): Promise<void> {
		return liveEdgeBackspace(this.ctx, blockIndex, content);
	}

	/** Backspace at a heading's content start demotes it before any merge. */
	liveDemoteHeading(blockIndex: number): Promise<void> {
		return liveDemoteHeading(this.ctx, blockIndex);
	}

	/** Enter inside a construct closes and reopens it, leaving both halves balanced. */
	liveSplitInsideConstruct(blockIndex: number, content: string): Promise<void> {
		return liveSplitInsideConstruct(this.ctx, blockIndex, content);
	}

	/** Click a rendered link, rewrite its destination in the card, Enter to commit. */
	liveLinkCardEdit(linkText: string, url: string): Promise<void> {
		return liveLinkCardEdit(this.ctx, linkText, url);
	}

	/** Backspace to merge a block into the one above, then type one byte where the caret landed
	 *  at the join (two undo entries, two undos). */
	liveMergeLanding(blockIndex: number, seamBefore: string, seamAfter: string): Promise<void> {
		return liveMergeLanding(this.ctx, blockIndex, seamBefore, seamAfter);
	}

	/** Home in a list item puts the caret at offset 0; one typed byte opens the line. */
	liveListHomeSeat(itemText: string): Promise<void> {
		return liveListHomeSeat(this.ctx, itemText);
	}

	/** Extend a selection into a table and collapse it again; no bytes may change. */
	liveExtendIntoTablePark(): Promise<void> {
		return liveExtendIntoTablePark(this.ctx);
	}

	/** Type `#` onto a new line below `blockIndex`, then its text: the new block resyncs, the
	 *  text is predicted. */
	liveTypeHeadingOpener(blockIndex: number, text: string): Promise<void> {
		return liveTypeHeadingOpener(this.ctx, blockIndex, text);
	}

	/** The same for a fence: three backticks create the block, then the info string is typed. */
	liveTypeFenceOpener(blockIndex: number, info: string): Promise<void> {
		return liveTypeFenceOpener(this.ctx, blockIndex, info);
	}

	/** The same for a table: the header row is predicted byte for byte, Enter builds the grid. */
	liveTypeTableOpener(blockIndex: number, cells: string[]): Promise<void> {
		return liveTypeTableOpener(this.ctx, blockIndex, cells);
	}

	// ── Decoration widgets and block decoration (plugins route, `?seed=sim`) ─────
	// Drawing a decoration never changes bytes, so each resyncs; deleting a replace widget and
	// backspacing through a see-through one both end with an undo.

	/** Walk the caret across a decoration: it steps over a replace one and through a widget. */
	walkAcrossIsland(blockIndex: number): Promise<void> {
		return walkAcrossIsland(this.ctx, blockIndex);
	}

	/** Two presses to select then delete a replace decoration, then undo it. */
	edgeDeleteReplaceIsland(blockIndex: number, key: 'Backspace' | 'Delete'): Promise<void> {
		return edgeDeleteReplaceIsland(this.ctx, blockIndex, key);
	}

	/** Backspace through a widget decoration onto the real byte beside it, then undo. */
	backspaceThroughWidgetIsland(blockIndex: number): Promise<void> {
		return backspaceThroughWidgetIsland(this.ctx, blockIndex);
	}

	/** Type a character at a decoration's trailing edge and delete it; the decoration survives. */
	typeAdjacentToIsland(blockIndex: number): Promise<void> {
		return typeAdjacentToIsland(this.ctx, blockIndex);
	}

	/** Reorder the badge-decorated block down and back; the badge follows the bytes. */
	reorderDecoratedBlock(blockIndex: number): Promise<void> {
		return reorderDecoratedBlock(this.ctx, blockIndex);
	}

	// ── Decoded-entity widget ────────────────────────────────────────────────────
	// The widget shows the character, not the reference it came from, so both gestures resync
	// rather than predict.

	typeEntityWidget(blockIndex: number, offset: number, reference: string): Promise<void> {
		return typeEntityWidget(this.ctx, blockIndex, offset, reference);
	}

	atomicDeleteEntityWidget(blockIndex: number): Promise<void> {
		return atomicDeleteEntityWidget(this.ctx, blockIndex);
	}

	// ── Emoji shortcode widget (first-party plugin, `?seed=emoji`) ───────────────
	// The widget shows the emoji, not the shortcode it came from, and the insert happens
	// mid-sentence, so all three resync.

	typeEmojiShortcode(blockIndex: number, offset: number, shortcode: string): Promise<void> {
		return typeEmojiShortcode(this.ctx, blockIndex, offset, shortcode);
	}

	stepOverEmoji(blockIndex: number): Promise<void> {
		return stepOverEmoji(this.ctx, blockIndex);
	}

	atomicDeleteEmoji(blockIndex: number): Promise<void> {
		return atomicDeleteEmoji(this.ctx, blockIndex);
	}

	// ── Native GitHub alerts (admonitions plugin, `?seed=admonitions`) ────────────
	// Each waits for the block to change kind or shape, then resyncs; the merge and the unwrap
	// check for themselves that the body stayed inside and the markers went.

	typeGithubAlert(
		targetIndex: number,
		alertType: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION',
		body: string
	): Promise<void> {
		return typeGithubAlert(this.ctx, targetIndex, alertType, body);
	}

	mergeGithubAlertMiddleChild(alertIndex: number, childIndex: number): Promise<void> {
		return mergeGithubAlertMiddleChild(this.ctx, alertIndex, childIndex);
	}

	reorderGithubAlertBodyChild(alertIndex: number, childIndex: number, dir: -1 | 1): Promise<void> {
		return reorderGithubAlertBodyChild(this.ctx, alertIndex, childIndex, dir);
	}

	unwrapGithubAlert(alertIndex: number): Promise<void> {
		return unwrapGithubAlert(this.ctx, alertIndex);
	}

	// ── IME composition (driven over CDP) ────────────────────────────────────────
	// Composition happens in the DOM alone, so the source does not change until the commit,
	// and the expected answer resyncs to the committed bytes. Requires `ctx.ime`.

	composeCommit(blockIndex: number, composition: CompositionCase): Promise<void> {
		return composeCommit(this.ctx, blockIndex, composition);
	}

	composeAbort(blockIndex: number, composition: CompositionCase): Promise<void> {
		return composeAbort(this.ctx, blockIndex, composition);
	}

	// ── Internal ────────────────────────────────────────────────────────────────

	/** Type a neighbouring key by mistake, wait, Backspace it out, wait; the bytes end up
	 *  unchanged. */
	private async injectCancellingTypo(intended: string): Promise<void> {
		const { editor, tracker } = this.ctx;
		const wrong = neighborKey(intended, this.rng);
		await editor.typeSlowly(wrong);
		await settleTypedSource(this.ctx, tracker.appendChar(wrong));
		await editor.page.keyboard.press('Backspace');
		await settleTypedSource(this.ctx, tracker.backspaceAtEnd());
	}
}

const KEY_NEIGHBORS: Record<string, string> = {
	a: 's',
	e: 'r',
	i: 'o',
	o: 'i',
	n: 'm',
	t: 'y',
	s: 'a',
	r: 'e'
};

function neighborKey(ch: string, rng: Rng): string {
	const lower = ch.toLowerCase();
	const neighbor = KEY_NEIGHBORS[lower];
	if (neighbor) return ch === lower ? neighbor : neighbor.toUpperCase();
	return rng.pick(['x', 'z', 'q'] as const);
}

function isLetter(ch: string): boolean {
	return /[a-z]/i.test(ch);
}
