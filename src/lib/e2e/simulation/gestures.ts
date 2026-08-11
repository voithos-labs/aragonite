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
	typeFreshItem
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

/**
 * The human-gesture vocabulary atop EditorPage. Each gesture performs a real keyboard/mouse
 * action, then either PREDICTS the bytes (printable typing) or RESYNCS the tracker
 * (auto-behavior), and settles on an observable predicate — never a bare sleep. The surface
 * is frozen: new gestures arrive as new methods, so a note fixture is never rewritten.
 */
export interface GestureOpts {
	typoRate?: number;
	onCheckpoint?: (label: string, gesture: string) => Promise<void>;
}

export class Gestures {
	private readonly typoRate: number;
	private readonly onCheckpoint?: (label: string, gesture: string) => Promise<void>;
	/** Set by a gesture that parks the caret away from the document end (see `hardBreakAt`). */
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
	 * Annotate a build boundary for the recorder. A no-op when unwired (only the capture run
	 * hooks it), so it mutates nothing and stays out of the deterministic spine.
	 */
	async checkpoint(label: string, gesture: string): Promise<void> {
		await this.onCheckpoint?.(label, gesture);
	}

	// ── Typing ────────────────────────────────────────────────────────────────

	async typeText(text: string): Promise<void> {
		const { editor, tracker } = this.ctx;
		// The tracker predicts insertion at the document end, so a mid-block caret would
		// surface as a source mismatch naming the wrong culprit. Fail at the real cause.
		if (this.caretParkedMidBlock) {
			throw new Error(
				`[${this.ctx.label}] typeText after hardBreakAt: the caret is parked mid-block, ` +
					`which the tracker's document-end model cannot predict. hardBreakAt must be a ` +
					`note's last build gesture.`
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
	 * Type the first line of a fresh list item: the first char resyncs around the marker
	 * materialization, the rest predicts. Nests past the ceiling char-by-char `typeText` hits.
	 */
	typeFreshItem(text: string): Promise<void> {
		return typeFreshItem(this.ctx, text);
	}

	// ── Navigation / repositioning ──────────────────────────────────────────────

	/**
	 * Real pointer click to reposition the caret, asserting the landing — a wrong-block
	 * landing must never be silently recorded as truth. The block PATH is the load-bearing
	 * assertion; the offset resyncs to whatever the click produced. Offset-precise or nested
	 * clicks go through `editor.clickBlockAtPath`.
	 */
	async clickToReposition(targetBlockPath: number[], _offset: number): Promise<void> {
		const { editor, tracker } = this.ctx;
		await editor.clickBlock(targetBlockPath[0]);
		await editor.waitForRenderFlush();
		await assertFocusBlock(this.ctx, targetBlockPath);
		tracker.resync(await editor.bridge.getSource());
	}

	/**
	 * Models noticing an earlier typo and going back to fix it. Net-identity, so end-state
	 * equality still holds.
	 */
	lateCorrection(targetBlockPath: number[]): Promise<void> {
		return lateCorrection(this.ctx, this, targetBlockPath);
	}

	// ── Structure ───────────────────────────────────────────────────────────────

	/** Enter splits a block; the transient empty block is auto-behavior, so resync. */
	async pressEnter(): Promise<void> {
		const { page, editor, tracker } = this.ctx;
		const hostsBefore = await page.evaluate(() => document.querySelectorAll('.block-host').length);
		await page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(hostsBefore + 1);
		tracker.resync(await editor.bridge.getSource());
	}

	// ── Delegators ──────────────────────────────────────────────────────────────
	// Thin facade over gestures/. Those take SimContext explicitly so they stay
	// unit-addressable and the frozen class surface grows without bloating this file.

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

	async hardBreakAt(blockPath: number[], offset: number): Promise<void> {
		await hardBreakAt(this.ctx, blockPath, offset);
		this.caretParkedMidBlock = true;
	}

	indent(): Promise<void> {
		return indent(this.ctx);
	}

	/**
	 * The `pressEnter` → `indentEmptyItem` → `typeFreshItem` cadence nests past the
	 * two-level ceiling that indenting a FILLED item hits.
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
	 * The opaque-container boundary declines, so this is a byte-exact no-op; a regression to
	 * the teleport changes the source and the gesture throws.
	 */
	reorderInContainer(bodyPath: number[]): Promise<void> {
		return reorderInContainer(this.ctx, bodyPath);
	}

	/**
	 * The mirror of `indentEmptyItem`. Settles on the focused item's path shortening; the
	 * next `typeFreshItem` materializes its marker.
	 */
	outdentEmptyItem(): Promise<void> {
		return outdentEmptyItem(this.ctx);
	}

	startQuote(text: string): Promise<void> {
		return startQuote(this.ctx, text);
	}

	continueQuote(text: string): Promise<void> {
		return continueQuote(this.ctx, text);
	}

	/** The typed `> >` nested quote the equality spine needs to guard the quote-exit fix. */
	nestQuote(text: string): Promise<void> {
		return nestQuote(this.ctx, text);
	}

	toggleTask(listItemPath: number[]): Promise<void> {
		return toggleTask(this.ctx, listItemPath);
	}

	/**
	 * Mint a paragraph at the between-blocks caret before `boundaryIndex`: the insert whose
	 * commit path no other gesture reaches, since the boundary belongs to no block's surface.
	 * Empty `text` presses Enter. Leaves the caret mid-document — a note's LAST gesture.
	 */
	mintAtGap(
		boundaryIndex: number,
		text: string,
		options?: { arrival?: 'backspace' | 'arrow-up' }
	): Promise<void> {
		return mintAtGap(this.ctx, boundaryIndex, text, options);
	}

	insertImage(alt: string, url: string): Promise<void> {
		return insertImage(this.ctx, alt, url);
	}

	resizeImage(direction: 'left' | 'right', steps: number): Promise<void> {
		return resizeImage(this.ctx, direction, steps);
	}

	// ── Math (LaTeX extension, plugins route) ───────────────────────────────────
	// Insert / reveal-edit-commit / delete inline `$…$` and block `$$…$$` math.
	// Each gesture gates on the widget↔source swap and resyncs around the reparse.

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

	/** Arrow-enter a block-final inline widget, walk through the revealed source and
	 *  out its leading edge, fold — a byte-identical caret-entry-reveal round trip. */
	walkThroughInlineMath(blockIndex: number): Promise<void> {
		return walkThroughInlineMath(this.ctx, blockIndex);
	}

	/** Backspace-enter a block-final inline widget, insert inside the formula, and
	 *  commit by escaping the trailing edge — the caret-escape reveal-commit path. */
	backspaceRevealEditInlineMath(blockIndex: number, insert: string): Promise<void> {
		return backspaceRevealEditInlineMath(this.ctx, blockIndex, insert);
	}

	// Both fence gestures act from a FLANKING prose block and never focus the fence, whose
	// render would reveal its source on pointerdown.

	/** Alt+Arrow the prose above the fence past it and back — a net-identity sibling
	 *  permutation the fence's raw and kind must survive unchanged. */
	reorderPastMathFence(proseIndex: number, fenceIndex: number): Promise<void> {
		return reorderPastMathFence(this.ctx, proseIndex, fenceIndex);
	}

	/** Backspace a cross-block range built from the prose above to the prose below, so
	 *  the fence is wholly interior — every fence byte must go, and one undo restores it. */
	deleteAcrossMathFence(fenceIndex: number): Promise<void> {
		return deleteAcrossMathFence(this.ctx, this, fenceIndex);
	}

	// ── Mermaid (whole-block focus, plugins route) ──────────────────────────────
	// Opaque childless diagram: each gates on a focus/structural signal and resyncs; the
	// delete and Enter detours net to identity via undo.

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
	// Each resyncs around the table's canonical cell auto-padding. Cells are addressed by
	// row-major rendered index, which SHIFTS after an insert/delete — the caller sequences
	// against the current grid.

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
	// Resyncs around the opener-byte rewrite and body mount/unmount. Only reachable over a
	// loaded document holding a details container.

	toggleCollapse(): Promise<void> {
		return toggleCollapse(this.ctx);
	}

	// A minted-command chord that bubbles from a callout leaf to the container handler.
	// Resyncs around the opener-byte rewrite; needs a loaded `:::callout` callout.
	setCalloutKind(): Promise<void> {
		return setCalloutKind(this.ctx);
	}

	// Real GitHub-alert paste (Mod+V) the admonitions pre-parse transform rewrites
	// to a :::tip admonition. Resyncs around the transform + reparse.
	pasteGithubAlert(): Promise<void> {
		return pasteGithubAlert(this.ctx);
	}

	// A READ-ONLY global chord: it republishes `window.__docStats` and commits nothing, so
	// the caller nets it to identity. Needs the doc-stats plugin installed.
	publishDocStats(): Promise<void> {
		return publishDocStats(this.ctx);
	}

	// ── Directives (`:::name` primitive, plugins route) ──────────────────────────
	// Each gates on the promotion or widget swap and resyncs around the reparse. Container
	// inserts arrive by PASTE — a multi-line fence never forms from live single-block typing.

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
	// Two tiers: the `[^label]: ` strip-container definition and the `[^label]` inline
	// reference widget. Everything here RESYNCS — the derived reference number is display
	// state the tracker never models, so nothing may predict it.

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

	// ── Cross-block selection + destruction ──────────────────────────────────────
	// Builds fail loud if the range never engaged; destroys settle on the collapse, run the
	// structural oracle sweep on the merged tree, and resync. The caller nets them to
	// identity with a trailing undo — cross-block destruction is byte-reversible.

	/** Extend the selection past the block boundary below/above the caret with Shift+Arrow. */
	extendSelectionAcross(dir: 'down' | 'up', maxSteps?: number): Promise<void> {
		return extendSelectionAcross(this.ctx, dir, maxSteps);
	}

	shiftClickAcross(targetPath: number[], offset: number): Promise<void> {
		return shiftClickAcross(this.ctx, targetPath, offset);
	}

	/** Double Ctrl+A: select the caret's block, then escalate to the whole document. */
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
	 * Backspace at block start: merges into the predecessor or delegates to the container-exit
	 * unwrap. Fails loud on a no-op (the first block has no predecessor), runs the structural
	 * oracle sweep, and resyncs; the caller nets it to identity with a trailing undo.
	 */
	mergeBackspaceAtStart(targetPath: number[]): Promise<void> {
		return mergeBackspaceAtStart(this.ctx, targetPath);
	}

	// ── Range interrupt ───────────────────────────────────────────────────────────

	/**
	 * Fire `gesture` over a live cross-block range, then one printable key, asserting the
	 * bytes against the outcome that gesture is pinned to — the precondition that hid two
	 * whole-document losses. Outcome vocabulary: `gestures/range-interrupt.ts`.
	 */
	rangeInterrupt(gesture: RangeInterruptGesture): Promise<void> {
		return rangeInterrupt(this.ctx, this, gesture);
	}

	// ── History ───────────────────────────────────────────────────────────────

	/**
	 * Flush the input batcher so the next gesture starts a FRESH undo entry — without it the
	 * batcher coalesces keystrokes within ~250ms into one. A deterministic fence, not a
	 * wall-clock wait.
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
	 * Flip to `mode` and back mid-session, asserting the note round-trips byte-identical.
	 * Auto-behavior, so it settles on the mode attribute and resyncs — the byte-stability
	 * oracle the loaded-ops battery otherwise never sees.
	 */
	flipPresentationMode(
		mode: 'reading' | 'preview-block' | 'preview-inline' | 'live'
	): Promise<void> {
		return flipPresentationMode(this.ctx, mode);
	}

	// ── Live-mode editing ───────────────────────────────────────────────────────
	// Each enters live through the toggle, drives one live-only rule, and undoes what it spent —
	// so every one nets to identity and a note fixture can fire it mid-session.

	/** Toggle a mark over a selected word; `strikethrough` and `inlineCode` are live's two new
	 *  chords, and all three write bytes immediately at a RANGE. */
	liveToggleFormat(blockIndex: number, word: string, format: LiveFormat): Promise<void> {
		return liveToggleFormat(this.ctx, blockIndex, word, format);
	}

	/** Backspace at a construct's trailing content edge takes the visible character, not the
	 *  delimiter native editing would have reached. */
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

	/** Backspace-merge a block into its predecessor, then type ONE byte at the seam the
	 *  landing door seated (two entries, two undos). */
	liveMergeLanding(blockIndex: number, seamBefore: string, seamAfter: string): Promise<void> {
		return liveMergeLanding(this.ctx, blockIndex, seamBefore, seamAfter);
	}

	/** Home in a list item seats through the sentinel door; one byte opens the line. */
	liveListHomeSeat(itemText: string): Promise<void> {
		return liveListHomeSeat(this.ctx, itemText);
	}

	/** Extend into a table (the cell arm parks the START sentinel) and collapse — byte-free. */
	liveExtendIntoTablePark(): Promise<void> {
		return liveExtendIntoTablePark(this.ctx);
	}

	/** Type `#` onto a fresh line below `blockIndex`, then its text: the mint resyncs, the text
	 *  predicts. */
	liveTypeHeadingOpener(blockIndex: number, text: string): Promise<void> {
		return liveTypeHeadingOpener(this.ctx, blockIndex, text);
	}

	/** The same on a fence: three backticks mint the block, the info string settles on its line. */
	liveTypeFenceOpener(blockIndex: number, info: string): Promise<void> {
		return liveTypeFenceOpener(this.ctx, blockIndex, info);
	}

	/** The adjacent-line member: the header row predicts byte for byte, Enter mints the grid. */
	liveTypeTableOpener(blockIndex: number, cells: string[]): Promise<void> {
		return liveTypeTableOpener(this.ctx, blockIndex, cells);
	}

	// ── Decoration islands + block decoration (plugins route, `?seed=sim`) ────────
	// Painting islands never changes bytes, so each resyncs; the replace delete and the
	// transparent widget backspace net to identity via undo.

	/** Walk the caret across an island — step-over for replace, transparency for widget. */
	walkAcrossIsland(blockIndex: number): Promise<void> {
		return walkAcrossIsland(this.ctx, blockIndex);
	}

	/** Two-press select-then-delete of a replace island, then undo (net identity). */
	edgeDeleteReplaceIsland(blockIndex: number, key: 'Backspace' | 'Delete'): Promise<void> {
		return edgeDeleteReplaceIsland(this.ctx, blockIndex, key);
	}

	/** Backspace through a widget island onto the adjacent real byte, then undo. */
	backspaceThroughWidgetIsland(blockIndex: number): Promise<void> {
		return backspaceThroughWidgetIsland(this.ctx, blockIndex);
	}

	/** Type a char at an island's trailing edge and delete it — the island survives. */
	typeAdjacentToIsland(blockIndex: number): Promise<void> {
		return typeAdjacentToIsland(this.ctx, blockIndex);
	}

	/** Reorder the badge-decorated block down and back; the badge follows the bytes. */
	reorderDecoratedBlock(blockIndex: number): Promise<void> {
		return reorderDecoratedBlock(this.ctx, blockIndex);
	}

	// ── Decoded-entity atomic widget ─────────────────────────────────────────────
	// The widget contributes its GLYPH, not its raw, so both resync rather than predict.

	typeEntityWidget(blockIndex: number, offset: number, reference: string): Promise<void> {
		return typeEntityWidget(this.ctx, blockIndex, offset, reference);
	}

	atomicDeleteEntityWidget(blockIndex: number): Promise<void> {
		return atomicDeleteEntityWidget(this.ctx, blockIndex);
	}

	// ── Emoji shortcode atomic widget (first-party plugin, `?seed=emoji`) ─────────
	// The widget contributes its GLYPH, not its raw, and the insert is mid-prose, so all
	// three resync.

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
	// Each gates on the promotion or structural change and resyncs; the merge and unwrap
	// assert containment and marker-drop internally.

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

	// ── IME composition (CDP-threaded) ───────────────────────────────────────────
	// The compose window is DOM-only, so the source stays byte-stable until commit and the
	// tracker resyncs around the committed bytes. Requires `ctx.ime`.

	composeCommit(blockIndex: number, composition: CompositionCase): Promise<void> {
		return composeCommit(this.ctx, blockIndex, composition);
	}

	composeAbort(blockIndex: number, composition: CompositionCase): Promise<void> {
		return composeAbort(this.ctx, blockIndex, composition);
	}

	// ── Internal ────────────────────────────────────────────────────────────────

	/** Type a wrong neighbor key, settle, Backspace it out, settle — nets to identity. */
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
