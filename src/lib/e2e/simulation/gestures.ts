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
	indent,
	indentEmptyItem,
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
	deleteAroundInlineMath,
	deleteInlineMathWidget,
	editBlockMath,
	editInlineMath,
	insertBlockMath,
	insertInlineMath,
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
	cutSelection,
	deleteSelection,
	extendSelectionAcross,
	pasteOverSelection,
	selectWholeDocument,
	shiftClickAcross,
	typeOverSelection
} from './gestures/cross-block';
import { mergeBackspaceAtStart } from './gestures/merge';
import {
	backspaceThroughWidgetIsland,
	edgeDeleteReplaceIsland,
	reorderDecoratedBlock,
	typeAdjacentToIsland,
	walkAcrossIsland
} from './gestures/decoration';
import { atomicDeleteEntityWidget, typeEntityWidget } from './gestures/entity';
import { composeAbort, composeCommit, type CompositionCase } from './gestures/ime';

/**
 * The human-gesture vocabulary atop EditorPage. Each gesture performs a real
 * keyboard/mouse action, then either predicts (printable typing) or resyncs
 * the tracker (auto-behavior), and settles on an observable state predicate —
 * never a bare sleep. The surface is frozen: new gestures arrive as new methods,
 * existing signatures don't change, so a note fixture never has to be rewritten.
 */
export interface GestureOpts {
	typoRate?: number;
	onCheckpoint?: (label: string, gesture: string) => Promise<void>;
}

export class Gestures {
	private readonly typoRate: number;
	private readonly onCheckpoint?: (label: string, gesture: string) => Promise<void>;

	constructor(
		private readonly ctx: SimContext,
		private readonly rng: Rng,
		opts: GestureOpts = {}
	) {
		this.typoRate = opts.typoRate ?? 0;
		this.onCheckpoint = opts.onCheckpoint;
	}

	/**
	 * Annotate a build boundary so the recorder can capture mid-build state. The
	 * fixture marks structural units as it authors them; the orchestrator decides
	 * whether anything is listening (only the capture run wires a hook). A no-op
	 * when unwired, so it mutates nothing and stays out of the deterministic spine.
	 */
	async checkpoint(label: string, gesture: string): Promise<void> {
		await this.onCheckpoint?.(label, gesture);
	}

	// ── Typing ────────────────────────────────────────────────────────────────

	async typeText(text: string): Promise<void> {
		const { editor, tracker } = this.ctx;
		for (const ch of text) {
			if (this.typoRate > 0 && isLetter(ch) && this.rng.chance(this.typoRate)) {
				await this.injectCancellingTypo(ch);
			}
			await editor.typeSlowly(ch);
			await settleTypedSource(this.ctx, tracker.appendChar(ch));
		}
	}

	/**
	 * Type the first line of a freshly-created list item. The first char resyncs
	 * around the marker materialization; the rest predicts. Lets a fixture nest
	 * past the two-level ceiling that char-by-char `typeText` hits on a nested item.
	 */
	typeFreshItem(text: string): Promise<void> {
		return typeFreshItem(this.ctx, text);
	}

	// ── Navigation / repositioning ──────────────────────────────────────────────

	/**
	 * Real pointer click into a top-level block to reposition the caret, then
	 * assert the focus block landed where intended — a wrong-block landing must
	 * never be silently recorded as truth. The caret offset is accepted for the
	 * frozen signature but the click lands at the block's natural hit point: the
	 * block path is the load-bearing assertion; the offset resyncs to whatever the
	 * click produced. Gestures needing an offset-precise or nested click go through
	 * `editor.clickBlockAtPath` instead.
	 */
	async clickToReposition(targetBlockPath: number[], _offset: number): Promise<void> {
		const { editor, tracker } = this.ctx;
		await editor.clickBlock(targetBlockPath[0]);
		await editor.waitForRenderFlush();
		await assertFocusBlock(this.ctx, targetBlockPath);
		tracker.resync(await editor.bridge.getSource());
	}

	/**
	 * Jump back into an earlier top-level block and make a net-identity edit there —
	 * models noticing an earlier typo and going to fix it. Reuses clickToReposition's
	 * block-path assertion; leaves the document unchanged, so end-state equality holds.
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
	// Thin facade over the per-concern free functions in gestures/. They take the
	// SimContext explicitly so they stay unit-addressable and the frozen class
	// surface grows without bloating this file.

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

	indent(): Promise<void> {
		return indent(this.ctx);
	}

	/**
	 * Nest the empty item just created by `pressEnter` one level deeper. The cadence
	 * `pressEnter` → `indentEmptyItem` → `typeFreshItem` builds bullet nesting past
	 * the two-level ceiling that indenting a filled item hits.
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
	 * Attempt a reorder on a body leaf inside a plugin (opaque) container. The
	 * boundary declines, so it is a byte-exact no-op; a regression to the teleport
	 * changes the source and the gesture throws.
	 */
	reorderInContainer(bodyPath: number[]): Promise<void> {
		return reorderInContainer(this.ctx, bodyPath);
	}

	/**
	 * Lift the empty item just created by `pressEnter` back out one level — the mirror
	 * of `indentEmptyItem`, used to return to a shallower branch after typing a deeper
	 * one. Settles on the focused item's path shortening; the next `typeFreshItem`
	 * materializes its marker.
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

	/**
	 * Nest one level deeper inside an open blockquote, producing a `> > ${text}` line —
	 * the typed nested-quote the equality spine needs to guard the `> >` exit fix.
	 */
	nestQuote(text: string): Promise<void> {
		return nestQuote(this.ctx, text);
	}

	toggleTask(listItemPath: number[]): Promise<void> {
		return toggleTask(this.ctx, listItemPath);
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

	// ── Mermaid (whole-block focus, plugins route) ──────────────────────────────
	// ArrowUp-stop, Enter-below, and the Backspace-from-below two-step delete on an
	// opaque childless diagram. Each gates on a focus/structural signal and resyncs;
	// the delete and Enter detours net to identity via undo.

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
	// Real cell-click + keyboard row/column ops. Each resyncs around the table's
	// canonical cell auto-padding. Cells are addressed by row-major rendered
	// index, which shifts after an insert/delete — the caller sequences against
	// the current grid. A live interactive table only exists after a load, so
	// these run over a loaded table, not a typed one.

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
	// Real click on a `<details>` collapse toggle. Resyncs around the opener-byte
	// rewrite and body mount/unmount (auto-behavior). Only reachable on the plugins
	// route, over a loaded document holding a details container.

	toggleCollapse(): Promise<void> {
		return toggleCollapse(this.ctx);
	}

	// Real minted-command chord (Mod+7/Mod+8) that bubbles from a callout leaf to
	// the container handler and commits the new type. Resyncs around the opener-byte
	// rewrite. Only reachable over a loaded document holding a `:::note` callout.
	setCalloutKind(): Promise<void> {
		return setCalloutKind(this.ctx);
	}

	// Real GitHub-alert paste (Mod+V) the admonitions pre-parse transform rewrites
	// to a :::tip admonition. Resyncs around the transform + reparse.
	pasteGithubAlert(): Promise<void> {
		return pasteGithubAlert(this.ctx);
	}

	// Real global-command chord (Mod+Shift+S) for the doc-stats plugin. A read-only
	// command: it republishes `window.__docStats` from the per-instance context and
	// commits nothing, so the caller nets it to identity. Only reachable where the
	// doc-stats plugin is installed (the plugins route).
	publishDocStats(): Promise<void> {
		return publishDocStats(this.ctx);
	}

	// ── Directives (`:::name` primitive, plugins route) ──────────────────────────
	// Insert / edit / reveal-commit across the container, leaf, and text tiers. Each
	// gates on the promotion or widget swap the editor performs and resyncs around
	// the reparse — container inserts arrive by paste (a multi-line fence never forms
	// from live single-block typing), so they compose the selection/clipboard gestures.

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
	// reference widget. Definition gestures gate on the container promotion; reference
	// gestures on the widget mount/reveal swap. Each resyncs around the reparse — the
	// derived reference number is display state the tracker never models, so nothing here
	// predicts it. The delete degrades to text and nets to identity via a trailing undo.

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

	editFootnoteLabel(refIndex: number, text: string): Promise<void> {
		return editFootnoteLabel(this.ctx, refIndex, text);
	}

	deleteFootnoteReference(refIndex: number): Promise<void> {
		return deleteFootnoteReference(this.ctx, refIndex);
	}

	// ── Cross-block selection + destruction ──────────────────────────────────────
	// Build a real cross-block range (Shift+Arrow / Shift+Click / double select-all)
	// then destroy over it (Backspace/Delete, Cut, type-over, paste-over). Builds
	// fail loud if the range never engaged; destroys settle on the collapse, run the
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
	 * Backspace at the start of the block at `targetPath` — merges it into its
	 * predecessor (para→para, heading absorb, container deepest leaf) or delegates to
	 * the container-exit unwrap (list U1, blockquote U2). Fails loud on a no-op (the
	 * document's first block has no predecessor); runs the structural oracle sweep and
	 * resyncs. The caller nets it to identity with a trailing undo.
	 */
	mergeBackspaceAtStart(targetPath: number[]): Promise<void> {
		return mergeBackspaceAtStart(this.ctx, targetPath);
	}

	// ── History ───────────────────────────────────────────────────────────────

	/**
	 * Flush the input batcher at a semantic boundary so the next gesture starts a
	 * fresh undo entry. Without this, the batcher coalesces keystrokes within ~250ms
	 * into one entry; a note that wants a real multi-entry undo stack calls this
	 * between the units it wants separately undoable. A fixed deterministic wait, not
	 * wall-clock-variable — it is the proven undo-batch fence the differential uses.
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
	 * Flip the presentation mode to `mode` and back to source mid-session, asserting
	 * the note round-trips byte-identical across the flip. A mode flip is auto-behavior
	 * (reading commits/inerts, preview re-renders), so it settles on the mode attribute
	 * and resyncs — the byte-stability oracle the loaded-ops battery otherwise never sees.
	 */
	flipPresentationMode(mode: 'reading' | 'preview-block' | 'preview-inline'): Promise<void> {
		return flipPresentationMode(this.ctx, mode);
	}

	// ── Decoration islands + block decoration (plugins route, `?seed=sim`) ────────
	// The standing island source paints replace/widget islands and a block badge at
	// content-keyed positions; these drive the caret/delete/typing surface they own.
	// Painting never changes bytes, so each resyncs; the replace delete and the
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
	// Type a character reference mid-prose (an atomic glyph widget), later delete it
	// whole in one atomic Backspace. The widget contributes its glyph not its raw, so
	// both resync rather than predict.

	typeEntityWidget(blockIndex: number, offset: number, reference: string): Promise<void> {
		return typeEntityWidget(this.ctx, blockIndex, offset, reference);
	}

	atomicDeleteEntityWidget(blockIndex: number): Promise<void> {
		return atomicDeleteEntityWidget(this.ctx, blockIndex);
	}

	// ── IME composition (CDP-threaded) ───────────────────────────────────────────
	// Compose a multibyte candidate and commit (or abort). The compose window is
	// DOM-only, so the source stays byte-stable until commit; the tracker resyncs
	// around the committed bytes. Requires `ctx.ime`, threaded once per session.

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
