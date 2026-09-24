/**
 * Inline-widget interaction for TextEditableBlock: the offset math and the handler
 * bodies that branch off keydown/click. Each keydown sub-handler returns whether it
 * consumed the event, so the component can interleave them with the shared pipeline.
 */

import { tick } from 'svelte';
import type { BlockEditActions, FocusActions } from '../../../action-contracts';
import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import type { NodeView } from '../../../core/node-views';
import type { PresentationMode } from '../../../presentation-mode';
import type { LinkReferenceResolverRef } from '../../../editor-keys';
import type { WidgetSelectionState } from '../../image/widget-selection-state.svelte';
import type { AmbientCursorIO } from '../../../ambient/ambient-cursor';
import { resolvedInlineContent } from '../../../core/inline/inline-cache';
import {
	flattenInlineWidgets,
	getInlineWidgetEditing,
	isCharacterLikeWidget,
	isWidgetActivationClick
} from '../../../core/inline/inline-widgets';
import { isVerticallyTransparentNode } from '../../../core/inline/transparency';
import { trimTrailingLineEnding, trailingLineEnding } from '../../../core/lines';
import {
	asRawOffset,
	toClampedRawOffset,
	toDomTextOffset
} from '../../../cursor/coordinate-spaces';
import {
	domTextOffsetAtNode,
	createRangeAtDomTextOffsets,
	selectionFocusWalkOffset
} from '../../../cursor/widget-offset';
import { createSourceReveal, type SourceReveal } from '../../../cursor/reveal-source';
import { nearestWidgetEdgeSeat, type WidgetEdgeCandidate } from '../../../cursor/widget-edge-snap';
import {
	traceRevealOpen,
	traceRevealFold,
	type RevealFoldReason
} from '../../../debug/interaction-trace';
import { assertInvariant } from '../../../assert';
import type { RevealFold } from '../editable-surface';
import type { GrammarView } from '../../../schema/block-openers';
import {
	caretIsInTextContent,
	hasModifier,
	isPlainTypingKey,
	surfaceHoldsRange
} from './click-snap-guard';
import {
	findWidgetNodeByStart,
	findFirstEdgeWidget,
	findLastEdgeWidget,
	rawHasNoTextBefore,
	rawHasNoTextAfter,
	widgetElByStart
} from './widget-adjacency';

export interface WidgetInteractionDeps {
	get node(): NodeView;
	get index(): number;
	get myPath(): number[];
	getEl: () => HTMLElement | null;
	getAmbientLength: () => number;
	getEditorContentWidth: () => number;
	cursor: AmbientCursorIO;
	widgetSelection: WidgetSelectionState;
	blockEdit: BlockEditActions;
	focusActions: FocusActions;
	setSnapTarget: (offset: number | null) => void;
	/** Remember a caret offset for the restore after the next render. `writtenText` is the
	 *  text that offset counts into: a kind that rewrites bytes on commit moves the offset,
	 *  and only that text can map it. */
	setPendingCursor: (offset: number | null, writtenText?: string) => void;
	/** The block's live DOM as raw text, read when a shown source is committed, to pick up
	 *  the temporary edit that never went through the CST. */
	readRawText: () => string;
	/** Tells the component a source is showing, so `onInput` and IME `compositionend`
	 *  skip the per-keystroke CST commit while it is. */
	setRevealing: (value: boolean) => void;
	/** Hiding a shown source mid-selection would strand a selection endpoint anchored in it. */
	isCrossBlock: () => boolean;
	/** The mode in effect; reading mode blocks showing a source and the widget edit
	 *  branches. Optional, so a bare harness reads as 'source'. */
	getPresentationMode?: () => PresentationMode;
	get linkRef(): LinkReferenceResolverRef;
	/** The editor's grammar, the one the render path drew widgets with. */
	grammar: GrammarView;
}

/** The click a widget gesture reads off: the same event the widget's own handler sees. */
export interface WidgetPress {
	/** Ctrl or Cmd held at the click: with it, a widget that takes the activation click keeps it. */
	modified?: boolean;
	/** `MouseEvent.detail`; two or more is a double-click, which selects the token it just opened. */
	clickCount?: number;
	/** The pointer travelled between press and release, so the gesture was a drag. Showing a
	 *  widget's source there would unmount the widget the drag just painted a range across. */
	moved?: boolean;
}

export interface WidgetInteraction {
	/** Block holds only image/blank inline content, so vertical arrow traversal skips
	 *  it: the widgets carry no column meaning. */
	isVerticallyTransparent(): boolean;
	/** Keydown while a widget is selected. Every key is consumed in that state, so a
	 *  true return must not fall through to the shared pipeline. */
	handleSelectedWidgetKeydown(e: KeyboardEvent): Promise<boolean>;
	/** Shift+Arrow into a widget; extends the browser selection to the far boundary. */
	handleShiftArrowIntoWidget(e: KeyboardEvent): boolean;
	/** Enter a widget at a caret edge: show its source or select it, as the kind's policy
	 *  says. The caret-edge dispatch decides which edge and calls this. */
	enterWidget(
		widget: { start: number; end: number; kind: AnyInlineKind },
		fromTrailingEdge: boolean
	): void;
	/** Arriving from another block: a widget at the near edge that can show its source
	 *  opens it, any other is selected. Returns whether an edge widget was entered. */
	enterEdgeWidget(side: 'start' | 'end'): boolean;
	/** Move a click that landed outside any text node to the nearest widget edge, or open the
	 *  source of a widget it hit. */
	snapClickToWidgetEdge(clickX: number | null, clickY: number | null, press?: WidgetPress): void;
	/** A caret restored strictly inside a widget that can show its source, such as a formula
	 *  that just closed around it, opens that source there instead of being pushed past it. */
	revealInterior(offset: number): boolean;
	/** A widget is currently showing its editable `$…$` source. */
	isRevealing(): boolean;
	/** Escape, which cancels back to the rendered form, while a source is shown. Enter is
	 *  deliberately left alone: it is the block's split command, which hides the source first. */
	handleRevealingKeydown(e: KeyboardEvent): Promise<boolean>;
	/** Commit the shown source when focus leaves the block. */
	commitRevealOnBlur(): void;
	/** Hide a shown source before any edit to the block, so the edit runs against a CST
	 *  that matches the DOM. Null if none was shown; otherwise the committed caret and a
	 *  write the caller has to await before editing. */
	foldRevealBeforeMutation(caretAfter?: number): RevealFold | null;
	/** Hide the source when the caret leaves it but stays inside the block; blur handles
	 *  the case where focus leaves the block. */
	foldRevealIfSelectionEscaped(): void;
	/** The point sits on a widget that can show its source. `pointerdown` then cancels the
	 *  browser's own caret placement so nothing races this one. */
	isPointOnRevealWidget(x: number, y: number): boolean;
	/**
	 * Where a press on a non-editable inline widget anchors a drag: the widget's own raw edge on
	 * the point's side, for a kind the caret reads as one character. Null over no widget, or over
	 * one running a pointer gesture of its own. The browser cannot answer this, since
	 * `user-select: none` makes it return a position in the neighbouring text that drifts with
	 * whatever is already selected.
	 */
	islandDragAnchor(x: number, y: number): number | null;
}

/** The widget edge a selected widget hands a caret-moving key off from, or null for any other key. */
function caretMoveEdge(key: string): 'start' | 'end' | null {
	switch (key) {
		case 'ArrowUp':
		case 'Home':
		case 'PageUp':
			return 'start';
		case 'ArrowDown':
		case 'End':
		case 'PageDown':
			return 'end';
		default:
			return null;
	}
}

/**
 * The inline-code tint over a shown source, drawn with the CSS Custom Highlight API
 * (`::highlight(md-inline-reveal)` in editor.css) rather than a wrapper span: the contract, and
 * every offset read against it, is that the source is a bare text node in the block. The range
 * selects the node, so it keeps covering the text as typing grows it. Without the API (jsdom, an
 * old browser) the source simply shows untinted.
 */
const REVEAL_HIGHLIGHT = 'md-inline-reveal';
const washRanges = new WeakMap<Text, Range>();

function revealHighlight(): Highlight | null {
	if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight !== 'function') {
		return null;
	}
	let highlight = CSS.highlights.get(REVEAL_HIGHLIGHT);
	if (!highlight) {
		highlight = new Highlight();
		CSS.highlights.set(REVEAL_HIGHLIGHT, highlight);
	}
	return highlight;
}

function washRevealedSource(node: Text): void {
	const highlight = revealHighlight();
	if (!highlight) return;
	const range = document.createRange();
	range.selectNode(node);
	washRanges.set(node, range);
	highlight.add(range);
}

function unwashRevealedSource(node: Text): void {
	const range = washRanges.get(node);
	if (!range) return;
	washRanges.delete(node);
	revealHighlight()?.delete(range);
}

/** What {@link replaceSelectedWidget} writes through. */
export interface WidgetReplaceDeps {
	get node(): NodeView;
	get index(): number;
	blockEdit: BlockEditActions;
	widgetSelection: WidgetSelectionState;
	setPendingCursor: (offset: number | null) => void;
}

/**
 * Replace a selected widget's bytes with `text` in one undoable write, anchored at the caret from
 * before the selection, and put the caret right after `text`: with the widget gone the browser
 * has no caret of its own to keep. Resolves once the write and the caret have landed.
 */
export async function replaceSelectedWidget(
	deps: WidgetReplaceDeps,
	widget: { start: number; end: number },
	preSelectOffset: number,
	text: string
): Promise<void> {
	const raw = deps.node.raw;
	const caretAfter = widget.start + text.length;
	const write = deps.blockEdit.updateBlockContent(
		deps.index,
		raw.slice(0, widget.start) + text + raw.slice(widget.end),
		preSelectOffset,
		caretAfter
	);
	// Before the write's render, so the caret and the new bytes land in one flush.
	deps.setPendingCursor(caretAfter);
	deps.widgetSelection.clear();
	await write;
	// The render that places the caret, so a caller awaiting the insert finds the caret there.
	await tick();
}

export function createWidgetInteraction(deps: WidgetInteractionDeps): WidgetInteraction {
	const isReading = () => deps.getPresentationMode?.() === 'reading';

	// Resolver-aware so widget detection matches the render path's view; a mismatch
	// around reference-style image widgets breaks cursor and clipboard offsets.
	function inlinesOf(node: NodeView): InlineNode[] {
		return resolvedInlineContent(node, deps.linkRef);
	}

	const widgetEditing = (kind: AnyInlineKind) => getInlineWidgetEditing(kind, deps.grammar);
	const characterLike = (kind: AnyInlineKind) => isCharacterLikeWidget(kind, deps.grammar);

	/**
	 * Every widget in this block, descending into parents that are not widgets themselves. The
	 * flat inline list is the wrong shape to scan: a construct wrapping a widget (emphasis around
	 * a math span, a link around an image) hides it, and a pointer or arrow-key path reading that
	 * list would not see it at all. `> *… $L/9 \times 10^{20}$ …*` is one such shape: the quote's
	 * whole text is a single emphasis node.
	 */
	function widgetsOf(): InlineNode[] {
		return flattenInlineWidgets(inlinesOf(deps.node), deps.node.raw, deps.grammar);
	}

	// ── Editing a widget's source ──────────────────────────────────────────────
	// A widget can swap its rendered form for editable source. That edit lives only in the DOM
	// (`onInput` stays suppressed) and re-renders on commit, so it lands as one undo entry. Every
	// exit clears its state through `resetReveal`, so a new exit decides only how the widget is
	// restored.
	interface RevealState {
		kernel: SourceReveal;
		/** Trailing-edge fallback for the commit caret when the source node is gone. */
		widgetEnd: number;
		/** Undo anchor: where the caret sat before entry. */
		caretBefore: number;
		/** The displayed text before the edit; a commit with no change touches no CST. */
		originalDisplay: string;
		/** The gap between showing the source and the caret arriving in it: a `selectionchange`
		 *  delivered inside that gap reads the old selection, not the caret leaving. */
		settling: boolean;
	}
	let revealState: RevealState | null = null;

	// Kept outside the record because they must survive `resetReveal` for the async restore.
	// The exact element matters: two byte-identical widgets share a pool key, so a lookup can
	// return the other instance and `replaceWith` would move it.
	let activeSourceNode: Text | null = null;
	let revealedWidget: HTMLElement | null = null;
	// The offset left behind when a source was last hidden, which lies inside that construct:
	// the restore must not read it as a formula closing around the caret and show it again.
	let foldParkedCaret: number | null = null;

	// Every way of hiding a source is private to this module and checked by all its callers,
	// so hiding with none shown means a caller skipped the check or a flag leaked (G1.26).
	function assertFoldTargetsActiveReveal(entry: string): void {
		assertInvariant('reveal-transition', () =>
			revealState
				? null
				: { code: 'fold-without-reveal', message: `${entry} with no active reveal` }
		);
	}

	function restoreRenderedWidget(): void {
		if (activeSourceNode === null || revealedWidget === null) return;
		unwashRevealedSource(activeSourceNode);
		activeSourceNode.replaceWith(revealedWidget);
		activeSourceNode = null;
		revealedWidget = null;
	}

	// The one teardown. Restoring the widget is a separate step, so the swap handles are
	// left alone: cancel resets the record before awaiting the restore, which still needs
	// them.
	function resetReveal(): void {
		revealState = null;
		deps.setRevealing(false);
	}

	async function startReveal(
		widget: { start: number; end: number },
		caretBefore: number,
		atSourceOffset = 0
	): Promise<void> {
		// Every way in comes through here, so this is the only reading-mode check needed.
		if (isReading()) return;
		// That gap spans only microtasks plus the synchronous focus dispatch, so no user
		// gesture lands inside it: a re-entry is a call from this chain itself (G1.26).
		assertInvariant('reveal-transition', () =>
			revealState?.settling
				? {
						code: 'start-during-settle',
						message: 'startReveal re-entered inside the reveal settle window'
					}
				: null
		);
		if (revealState) return;
		traceRevealOpen('inline');
		const start = widget.start;
		const end = widget.end;
		const source = deps.node.raw.slice(start, end);
		// Swapping the span is the whole mechanism: the opaque widget becomes a text node.
		const kernel = createSourceReveal({
			get container() {
				return deps.getEl();
			},
			get sourceStart() {
				return start;
			},
			get sourceEnd() {
				return end;
			},
			get source() {
				return source;
			},
			getAmbientLength: deps.getAmbientLength,
			isRevealed: () => activeSourceNode !== null,
			showSource: () => {
				const container = deps.getEl();
				if (!container) return;
				const widget = widgetElByStart(container, start);
				if (!widget) return;
				revealedWidget = widget;
				activeSourceNode = document.createTextNode(source);
				widget.replaceWith(activeSourceNode);
				washRevealedSource(activeSourceNode);
			},
			// Re-inserts the exact element the swap detached, still current because the edit
			// was discarded. The persist path re-renders reactively instead.
			showRendered: restoreRenderedWidget
		});
		revealState = {
			kernel,
			widgetEnd: end,
			caretBefore,
			originalDisplay: trimTrailingLineEnding(deps.node.raw),
			settling: true
		};
		deps.widgetSelection.clear();
		deps.setRevealing(true);
		try {
			await kernel.reveal(atSourceOffset);
		} finally {
			// `finally`, not a plain clear: a flag stuck true would disable the escape check for
			// the rest of the block's life. Null-checked, since hiding mid-await already cleared it.
			if (revealState) revealState.settling = false;
		}
	}

	// Save the temporary source edit, or hide the source again untouched. The caret lands on
	// the source node's current trailing edge, so a concurrent prose edit shifts it correctly.
	// It always hides: a null read as "nothing to wait for" would let a caller splice stale bytes.
	function commitReveal(
		reason: RevealFoldReason = 'commit',
		caretOverride?: number
	): RevealFold | null {
		assertFoldTargetsActiveReveal('commitReveal');
		if (!revealState) return null;
		// Aliased before any call: TS drops the null-narrowing of a closure-reassigned
		// `let` across an intervening call.
		const active = revealState;
		traceRevealFold(reason);
		const el = deps.getEl();
		const sourceNode = activeSourceNode;
		const editedDisplay = deps.readRawText();
		const caretAfter =
			caretOverride ??
			(el && sourceNode
				? toClampedRawOffset(
						domTextOffsetAtNode(el, sourceNode, sourceNode.length),
						deps.getAmbientLength()
					)
				: active.widgetEnd);
		const { caretBefore, originalDisplay } = active;
		// The reactive re-render rebuilds the widget, so drop the swap handles without
		// restoring the DOM, then run the teardown.
		if (sourceNode) unwashRevealedSource(sourceNode);
		activeSourceNode = null;
		revealedWidget = null;
		resetReveal();
		foldParkedCaret = caretAfter;
		// No edit: hide the source without touching the CST. A write that changes nothing
		// still pushes an undo entry, so the next Ctrl+Z would revert nothing instead of the
		// user's previous action. Setting the pending cursor re-renders from the same CST.
		if (editedDisplay === originalDisplay) {
			deps.setPendingCursor(caretAfter);
			return { caret: caretAfter, settled: tick() };
		}
		const write = deps.blockEdit.updateBlockContent(
			deps.index,
			editedDisplay + trailingLineEnding(deps.node.raw),
			caretBefore,
			caretAfter
		);
		deps.setPendingCursor(caretAfter, editedDisplay);
		return { caret: caretAfter, settled: settleWrite(write) };
	}

	// What "settled" means for every caller: the write landed and the render it forced has
	// flushed. A rejection is swallowed, because the commit sequence rethrows only in dev
	// builds, and forwarding it would let a dev-only throw cancel the gesture in progress.
	async function settleWrite(write: void | Promise<void>): Promise<void> {
		try {
			await write;
		} catch {
			// reported where the commit happens
		}
		await tick();
	}

	// Discard the temporary edit and rebuild the original widget from the untouched raw:
	// a change of view only, so no undo entry.
	async function cancelReveal(): Promise<void> {
		assertFoldTargetsActiveReveal('cancelReveal');
		if (!revealState) return;
		const active = revealState;
		traceRevealFold('cancel');
		const { kernel } = active;
		// Reset before the await so the record reads idle across the restore: `replaceWith`
		// fires `selectionchange`, and a live record would let the escape check re-enter
		// mid-swap. The restore reads the swap handles kept outside the record.
		resetReveal();
		await kernel.commit();
	}

	// Clicking away from a source that was not edited: no caret is written, because the
	// click that left owns the caret and the commit path's trailing edge would steal it. A
	// selected range is different: the rebuild leaves its end inside a widget, so it is read in
	// raw offsets, which no byte here moves, and put back once the block has been rebuilt.
	function foldRevealNoEdit(reason: RevealFoldReason = 'no-edit'): void {
		assertFoldTargetsActiveReveal('foldRevealNoEdit');
		if (!revealState) return;
		traceRevealFold(reason);
		const span = liveRangeInBlock();
		resetReveal();
		restoreRenderedWidget();
		if (span) void restoreRangeInBlock(span);
	}

	/** The live selection in raw offsets, when it is a range with both ends inside this block. */
	function liveRangeInBlock(): { start: number; end: number } | null {
		const el = deps.getEl();
		const sel = window.getSelection();
		if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
		const range = sel.getRangeAt(0);
		if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
		const ambient = deps.getAmbientLength();
		const rawAt = (node: Node, offset: number) =>
			toClampedRawOffset(domTextOffsetAtNode(el, node, offset), ambient);
		return {
			start: rawAt(range.startContainer, range.startOffset),
			end: rawAt(range.endContainer, range.endOffset)
		};
	}

	async function restoreRangeInBlock(span: { start: number; end: number }): Promise<void> {
		await tick();
		const el = deps.getEl();
		const sel = window.getSelection();
		if (!el || !sel) return;
		const ambient = deps.getAmbientLength();
		const range = createRangeAtDomTextOffsets(
			el,
			toDomTextOffset(asRawOffset(span.start), ambient),
			toDomTextOffset(asRawOffset(span.end), ambient)
		);
		if (!range) return;
		sel.removeAllRanges();
		sel.addRange(range);
	}

	// Whether the caret is still inside is decided by raw offset through the shared traversal,
	// bounds included: a caret at the source's edge may anchor in the neighbouring text node,
	// which is the browser's choice, and comparing nodes would misread that as leaving.
	function selectionEscapedSource(): boolean {
		if (!revealState || !activeSourceNode || revealState.settling) return false;
		if (deps.isCrossBlock()) return false;
		const el = deps.getEl();
		const sel = window.getSelection();
		if (!el || !sel || sel.rangeCount === 0) return false;
		const { anchorNode, focusNode } = sel;
		if (!anchorNode || !focusNode) return false;
		if (!el.contains(anchorNode) || !el.contains(focusNode)) return false;
		if (activeSourceNode.contains(anchorNode) || activeSourceNode.contains(focusNode)) return false;
		const ambient = deps.getAmbientLength();
		const sourceStart = toClampedRawOffset(domTextOffsetAtNode(el, activeSourceNode, 0), ambient);
		const sourceEnd = sourceStart + activeSourceNode.length;
		const anchorOff = toClampedRawOffset(
			domTextOffsetAtNode(el, anchorNode, sel.anchorOffset),
			ambient
		);
		const focusOff = toClampedRawOffset(
			domTextOffsetAtNode(el, focusNode, sel.focusOffset),
			ambient
		);
		const inSource = (o: number) => o >= sourceStart && o <= sourceEnd;
		return !inSource(anchorOff) && !inSource(focusOff);
	}

	// The caret leaving has to survive a tick before the source is hidden: entering a cross-block
	// selection clears the browser selection before its flag is set, which briefly looks the same
	// and a re-check rejects. This flag outlives the exit it triggers, so `resetReveal` leaves it.
	let foldCheckQueued = false;
	function foldRevealIfSelectionEscaped(): void {
		if (foldCheckQueued || !selectionEscapedSource()) return;
		foldCheckQueued = true;
		void (async () => {
			try {
				await tick();
			} finally {
				foldCheckQueued = false;
			}
			if (!selectionEscapedSource() || !revealState) return;
			const active = revealState;
			if (deps.readRawText() === active.originalDisplay) {
				foldRevealNoEdit('selection-escape');
				return;
			}
			commitReveal('selection-escape');
		})();
	}

	// The one hit test shared by the pointerdown check, the click dispatch, and the re-resolve
	// after a source is hidden.
	/**
	 * What the pointer is actually over, asked of the DOM rather than of a rectangle. A widget's
	 * border box is not what the user sees: a KaTeX render such as a superscript or a fraction
	 * draws above and below its own box, so a click on the visible glyphs can miss the rectangle
	 * by a pixel or two. `elementFromPoint` has no such gap: it answers with whatever is drawn
	 * at the point, overflow included.
	 */
	function revealWidgetFromDom(
		el: HTMLElement,
		x: number,
		y: number
	): { inline: InlineNode } | null {
		// Feature-detected: jsdom implements no hit testing, and the rectangle scan below is the
		// answer there, the same shape as the `getTargetRanges` detection in the code block.
		if (typeof document.elementFromPoint !== 'function') return null;
		const at = document.elementFromPoint(x, y);
		const island =
			at instanceof Element ? at.closest('[data-inline-widget][data-source-start]') : null;
		// The point may sit over another block's widget entirely.
		if (!island || !el.contains(island)) return null;
		const start = Number(island.getAttribute('data-source-start'));
		if (!Number.isInteger(start)) return null;
		const inline = widgetsOf().find(
			(n) => n.start === start && widgetEditing(n.kind)?.revealSource
		);
		return inline ? { inline } : null;
	}

	/**
	 * Where a click on a rendered widget puts the caret when the kind maps no point: the end of
	 * the content the kind names, inside its delimiters, so typing continues the construct rather
	 * than escaping it. A kind that names no span keeps the leading edge, because guessing an end
	 * from the parsed text puts a footnote's caret past its bracket.
	 */
	function insideEndOffset(inline: InlineNode): number {
		const source = deps.node.raw.slice(inline.start, inline.end);
		const span = widgetEditing(inline.kind)?.revealContentSpan?.(source);
		return span && span.end >= 0 && span.end <= source.length ? span.end : 0;
	}

	/** The offset a click names inside a widget's source. Read against the layout from before
	 *  any source was hidden: hiding one reflows the line, and the point then means nothing. */
	function seatFromPoint(el: HTMLElement, inline: InlineNode, x: number, y: number): number | null {
		const widget = widgetElByStart(el, inline.start);
		const atPoint = widgetEditing(inline.kind)?.revealOffsetAtPoint;
		if (!widget || !atPoint) return null;
		const source = deps.node.raw.slice(inline.start, inline.end);
		const seat = atPoint(widget, source, x, y);
		return seat === null ? null : Math.max(0, Math.min(seat, source.length));
	}

	function hitTestRevealWidget(
		el: HTMLElement,
		x: number,
		y: number
	): { inline: InlineNode } | null {
		const painted = revealWidgetFromDom(el, x, y);
		if (painted) return painted;
		// Fallback for a point the DOM cannot answer for, such as a synthetic call with no
		// element under it: the box test, which still covers a widget that draws inside its
		// own bounds.

		for (const inline of widgetsOf()) {
			if (!widgetEditing(inline.kind)?.revealSource) continue;
			const widget = widgetElByStart(el, inline.start);
			if (!widget) continue;
			const rect = widget.getBoundingClientRect();
			if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
				return { inline };
			}
		}
		return null;
	}

	function isPointOnRevealWidget(x: number, y: number): boolean {
		const el = deps.getEl();
		return el !== null && hitTestRevealWidget(el, x, y) !== null;
	}

	function islandDragAnchor(x: number, y: number): number | null {
		const el = deps.getEl();
		if (!el) return null;
		const seat = nearestWidgetEdgeSeat(measuredWidgets(el, dragsFromIsland), x, y);
		return seat?.inside ? seat.offset : null;
	}

	// Selecting the whole token belongs to the double-click that opened the source, and nothing
	// in the second click's own shape tells it apart from a later one inside that source.
	let revealOpenedByLastClick = false;

	// The order is the whole point: resolve the target before hiding the current source, because
	// hiding shifts the layout and the click point only means something against the old one;
	// then find it again by offset, because a committed edit shifts raw positions.
	async function revealFromClick(clickX: number, clickY: number): Promise<void> {
		const el = deps.getEl();
		if (!el) return;
		const hit = hitTestRevealWidget(el, clickX, clickY);
		if (!hit) return;
		const seat = seatFromPoint(el, hit.inline, clickX, clickY);
		let targetStart = hit.inline.start;
		if (revealState) {
			const active = revealState;
			const revealedStart =
				activeSourceNode === null
					? Number.POSITIVE_INFINITY
					: toClampedRawOffset(
							domTextOffsetAtNode(el, activeSourceNode, 0),
							deps.getAmbientLength()
						);
			const rawBefore = deps.node.raw.length;
			if (deps.readRawText() === active.originalDisplay) {
				foldRevealNoEdit();
			} else {
				await commitReveal()?.settled;
				if (revealedStart < targetStart) targetStart += deps.node.raw.length - rawBefore;
			}
		}
		const target = widgetsOf().find(
			(n) => n.start === targetStart && widgetEditing(n.kind)?.revealSource
		);
		if (!target) return;
		el.focus();
		revealOpenedByLastClick = true;
		void startReveal(target, target.start, seat ?? insideEndOffset(target));
	}

	/**
	 * Select the whole shown token; refuses unless the double-click landed on it. Decided from
	 * the point, not the selection: the editor root's word-select on the second click runs first
	 * and may have moved the selection off the source.
	 */
	function selectRevealedSource(x: number, y: number | null): boolean {
		const source = activeSourceNode;
		if (!revealState || !source || y === null) return false;
		const range = document.createRange();
		range.selectNodeContents(source);
		const onSource = Array.from(range.getClientRects()).some(
			(r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
		);
		const selection = window.getSelection();
		if (!onSource || !selection) return false;
		selection.removeAllRanges();
		selection.addRange(range);
		return true;
	}

	function isRevealing(): boolean {
		return revealState !== null;
	}

	// Escape is the only key handled while a source is shown. Enter deliberately is not: it is
	// the block's split command everywhere else, and the command path hides the source before
	// it writes, so one Enter both commits the edit and splits.
	async function handleRevealingKeydown(e: KeyboardEvent): Promise<boolean> {
		if (!revealState) return false;
		if (e.key === 'Escape') {
			e.preventDefault();
			await cancelReveal();
			return true;
		}
		return false;
	}

	// The one case that does nothing during a cross-block selection: a drag keeps the source
	// shown so its rectangles measure real text and no endpoint anchored in it is stranded
	// (`selectionEscapedSource` carries the same rule).
	function commitRevealOnBlur(): void {
		if (revealState && !deps.isCrossBlock()) commitReveal('blur');
	}

	// An edit runs against `node.raw`, which a shown source has already outrun, so the source
	// is hidden first. Returns the committed caret, since a caret left on an element-level edge
	// would land a paste at offset 0, plus the write's completion.
	function foldRevealBeforeMutation(caretAfter?: number): RevealFold | null {
		if (!revealState) return null;
		return commitReveal('commit', caretAfter);
	}

	function isVerticallyTransparent(): boolean {
		// Resolver-free, matching the off-window keyboard-extend path, so the vertical-skip
		// decision is uniform everywhere. Other widget reads stay resolver-aware.
		return isVerticallyTransparentNode(deps.node, deps.grammar);
	}

	async function handleSelectedWidgetKeydown(e: KeyboardEvent): Promise<boolean> {
		const node = deps.node;
		const selectedWidget = deps.widgetSelection.getSelected();
		if (selectedWidget === null) return false;

		const widget = findWidgetNodeByStart(
			selectedWidget.sourceStart,
			inlinesOf(node),
			node.raw,
			deps.grammar
		);
		const widgetIsHere =
			widget !== null && deps.widgetSelection.isSelected(deps.myPath, selectedWidget.sourceStart);
		if (!widgetIsHere) return false;

		// The kind's editing policy takes its own keys first. Flattened so the nested image
		// of `[![alt][ref]][repo]` is the widget resolved.
		const inline = flattenInlineWidgets(inlinesOf(node), node.raw, deps.grammar).find(
			(n) => n.start === widget.start
		);
		if (inline) {
			const policy = widgetEditing(inline.kind);
			const consumed = policy?.onSelectedKey?.(e, {
				node,
				inline,
				widgetStart: widget.start,
				widgetEnd: widget.end,
				index: deps.index,
				preSelectOffset: selectedWidget.preSelectOffset,
				editorContentWidth: deps.getEditorContentWidth(),
				presentationMode: deps.getPresentationMode?.() ?? 'source',
				updateContent: (newRaw, caretBefore, caretAfter) =>
					void deps.blockEdit.updateBlockContent(deps.index, newRaw, caretBefore, caretAfter)
			});
			if (consumed) return true;
		}
		// Declining hands the chord to the keymap dispatch, which runs after this handler and
		// owns undo and redo. Arrows are the exception: selecting cleared the browser range, so
		// a later handler would read offset 0 and move focus to a block that is not there.
		if (hasModifier(e)) {
			if (!e.key.startsWith('Arrow')) return false;
			e.preventDefault();
			return true;
		}
		// Consumed even by a kind that handles no Shift+Arrow: stepping out is reserved
		// for a plain Arrow.
		if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
			e.preventDefault();
			return true;
		}
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			const left = e.key === 'ArrowLeft';
			const blankSide = left
				? rawHasNoTextBefore(node.raw, widget.start)
				: rawHasNoTextAfter(node.raw, widget.end);
			if (blankSide) {
				deps.widgetSelection.clear();
				await deps.focusActions.moveFocus(deps.index + (left ? -1 : 1), left ? 'end' : 'start');
			} else {
				deps.cursor.setRaw(asRawOffset(left ? widget.start : widget.end));
				deps.widgetSelection.clear();
			}
			return true;
		}
		// A vertical arrow, Home, End and the page keys are shared moves that need a real caret to
		// read: put one at the edge the key leaves from and decline, so the move runs from there.
		const moveEdge = e.shiftKey ? null : caretMoveEdge(e.key);
		if (moveEdge) {
			deps.cursor.setRaw(asRawOffset(moveEdge === 'start' ? widget.start : widget.end));
			deps.widgetSelection.clear();
			return false;
		}
		// Reading mode still consumes the key, since a selected widget owns its keys, but writes
		// nothing.
		const spliceWidget = (text: string): void => {
			if (isReading()) return;
			void replaceSelectedWidget(deps, widget, selectedWidget.preSelectOffset, text);
		};
		if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			spliceWidget('');
			return true;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			deps.cursor.setRaw(asRawOffset(widget.end));
			deps.widgetSelection.clear();
			return true;
		}
		if (isPlainTypingKey(e)) {
			e.preventDefault();
			spliceWidget(e.key);
			return true;
		}
		// Every remaining key is consumed, so navigation cannot leak into the shared handling
		// while a widget is selected. `preventDefault` too: reporting the key consumed stops
		// only this editor's chain, and the browser's default would still edit behind the CST.
		e.preventDefault();
		return true;
	}

	function handleShiftArrowIntoWidget(e: KeyboardEvent): boolean {
		// While a source is shown the CST still reports an atomic widget, but the DOM holds
		// editable text: let the browser's selection run over it, not past a widget that is gone.
		if (revealState) return false;
		const el = deps.getEl();
		if (!el) return false;
		if (!e.shiftKey || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return false;
		const widgetExt = widgetExtensionTarget(e.key);
		if (widgetExt === null) return false;
		e.preventDefault();
		extendSelectionToRaw(widgetExt);
		return true;
	}

	// The one place the show-source-or-select choice is made, shared by caret entry inside the
	// block and arrival from another block. `fromTrailingEdge` fixes both where the caret goes
	// in the source and the undo anchor.
	function enterWidget(
		widget: { start: number; end: number; kind: AnyInlineKind },
		fromTrailingEdge: boolean
	): void {
		const enteredOffset = fromTrailingEdge ? widget.end : widget.start;
		if (widgetEditing(widget.kind)?.revealSource) {
			const atSourceOffset = fromTrailingEdge ? widget.end - widget.start : 0;
			void startReveal(widget, enteredOffset, atSourceOffset);
		} else {
			deps.widgetSelection.select({
				paragraphPath: deps.myPath,
				sourceStart: widget.start,
				preSelectOffset: enteredOffset
			});
		}
	}

	// Only where the kind names a content span and the caret is inside it: a hard break is two
	// bytes with a caret position between them and nothing to edit there.
	function revealInterior(offset: number): boolean {
		const parkedByFold = foldParkedCaret === offset;
		foldParkedCaret = null;
		if (parkedByFold || revealState) return false;
		const widget = widgetsOf().find((w) => w.start < offset && offset < w.end);
		if (!widget) return false;
		const editing = widgetEditing(widget.kind);
		if (!editing?.revealSource || !editing.revealContentSpan) return false;
		const at = offset - widget.start;
		const span = editing.revealContentSpan(deps.node.raw.slice(widget.start, widget.end));
		if (!span || at < span.start || at > span.end) return false;
		void startReveal(widget, offset, at);
		return true;
	}

	function enterEdgeWidget(side: 'start' | 'end'): boolean {
		const inlines = inlinesOf(deps.node);
		if (inlines.length === 0) return false;
		const target =
			side === 'start'
				? findFirstEdgeWidget(inlines, deps.node.raw, deps.grammar)
				: findLastEdgeWidget(inlines, deps.node.raw, deps.grammar);
		if (!target) return false;
		// Focus the contenteditable so subsequent keys route to this block's handler.
		deps.getEl()?.focus();
		enterWidget(target, side === 'end');
		return true;
	}

	function snapClickToWidgetEdge(
		clickX: number | null,
		clickY: number | null,
		press: WidgetPress = {}
	): void {
		deps.setSnapTarget(null);
		const clickCount = press.clickCount ?? 1;
		// Every double-click starts with a single click, so that first click is where the flag
		// is set and any flag left over from an earlier gesture is cleared.
		if (clickCount === 1) revealOpenedByLastClick = false;
		const el = deps.getEl();
		if (!el || clickX === null) return;
		// The point-in-rectangle test runs before the text-node check below, so a click on real
		// text on another visual line falls through to the caret path. A third click selects the
		// block (`selection/multi-click.ts`), and showing a source under it would place a caret
		// over the range it just painted.
		if (clickY !== null && clickCount < 3) {
			const hit = press.moved ? null : hitTestRevealWidget(el, clickX, clickY);
			if (hit) {
				// Returns rather than falls through: the edge-snap below would focus this block and
				// place a caret, stealing back what the widget's own navigation just landed.
				if (
					widgetEditing(hit.inline.kind)?.claimsActivationClick &&
					isWidgetActivationClick(press.modified ?? false, deps.getPresentationMode?.() ?? 'source')
				) {
					return;
				}
				void revealFromClick(clickX, clickY);
				return;
			}
		}
		// The first click of a double-click already showed the source, so the second lands in
		// that text and the browser's word rule takes `[` or `$` as a word of its own. Taking the
		// whole token is that second click's; a third click belongs to the block.
		if (clickCount === 2 && revealOpenedByLastClick && selectRevealedSource(clickX, clickY)) return;
		// The snap below places a caret, so it does nothing while this block shows a selected
		// range, which it would collapse; `clampOutOfAmbient` already carries that rule.
		const live = window.getSelection();
		if (surfaceHoldsRange(el, live)) return;
		const seat = nearestWidgetEdgeSeat(measuredWidgets(el), clickX, clickY);
		if (seat === null) return;
		// A click beside a widget leaves a visible caret alone; a click on one cannot, since the
		// browser answers that hit test with a position in the neighbouring text.
		if (!seat.inside && caretIsInTextContent(el, live)) return;
		el.focus();
		deps.cursor.setRaw(asRawOffset(seat.offset));
		// `setRaw` may have landed in a trailing text node, where the browser draws a caret.
		if (!caretIsInTextContent(el, window.getSelection())) deps.setSnapTarget(seat.offset);
	}

	function* measuredWidgets(
		el: HTMLElement,
		seatsInside: (kind: AnyInlineKind) => boolean = characterLike
	): Generator<WidgetEdgeCandidate> {
		for (const inline of widgetsOf()) {
			const widget = widgetElByStart(el, inline.start);
			if (widget) {
				yield {
					start: inline.start,
					end: inline.end,
					rect: widget.getBoundingClientRect(),
					seatsInside: seatsInside(inline.kind)
				};
			}
		}
	}

	/**
	 * Which inline widgets a drag may start inside. All of them are `contenteditable=false`, so the
	 * browser starts no selection from any, but a kind with a pointer gesture of its own (an
	 * image's resize handles) owns its press, and a range painted under it would fight that gesture.
	 */
	function dragsFromIsland(kind: AnyInlineKind): boolean {
		return characterLike(kind) || widgetEditing(kind)?.revealSource === true;
	}

	function widgetExtensionTarget(key: 'ArrowRight' | 'ArrowLeft'): number | null {
		const el = deps.getEl();
		if (!el) return null;
		const focus = selectionFocusWalkOffset(el, deps.getAmbientLength());
		if (focus === null) return null;
		for (const inline of widgetsOf()) {
			if (key === 'ArrowRight' && focus >= inline.start && focus < inline.end) {
				return inline.end;
			}
			if (key === 'ArrowLeft' && focus > inline.start && focus <= inline.end) {
				return inline.start;
			}
		}
		return null;
	}

	function extendSelectionToRaw(rawOffset: number): void {
		const el = deps.getEl();
		if (!el) return;
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const target = toDomTextOffset(asRawOffset(rawOffset), deps.getAmbientLength());
		const range = createRangeAtDomTextOffsets(el, target, target);
		if (!range) return;
		sel.extend(range.endContainer, range.endOffset);
	}

	return {
		isVerticallyTransparent,
		handleSelectedWidgetKeydown,
		handleShiftArrowIntoWidget,
		enterWidget,
		revealInterior,
		enterEdgeWidget,
		snapClickToWidgetEdge,
		isRevealing,
		handleRevealingKeydown,
		commitRevealOnBlur,
		foldRevealBeforeMutation,
		foldRevealIfSelectionEscaped,
		isPointOnRevealWidget,
		islandDragAnchor
	};
}
