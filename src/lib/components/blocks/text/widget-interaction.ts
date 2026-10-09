/**
 * Inline-widget interaction for the prose editable elements (the text block and the table cell):
 * selecting a widget, showing its source, and the keydown and click handlers around both. Each
 * keydown handler returns whether it consumed the event, so the component can interleave them
 * with the shared pipeline.
 */

import { tick } from 'svelte';
import type { BlockEditActions, ContentWrite, FocusActions } from '../../../action-contracts';
import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import type { NodeView } from '../../../core/node-views';
import type { SurfaceBackend } from '../../../caret/surface-backend';
import { selectWidgetWhole } from '../../../selection/place-caret';
import type { SelectionState } from '../../../selection/selection-state.svelte';
import {
	getInlineWidgetEditing,
	isCharacterLikeWidget,
	widgetActivates
} from '../../../core/inline/inline-widgets';
import { isVerticallyTransparentNode } from '../../../core/inline/transparency';
import { trimTrailingLineEnding } from '../../../core/lines';
import { asRawOffset } from '../../../caret/coordinate-spaces';
import { rawOffsetAt, rawSelectionFocus, type CaretWriter } from '../../../caret/widget-offset';
import { createSourceReveal, type SourceReveal } from '../../../caret/reveal-source';
import { nearestWidgetEdgeSeat, type WidgetEdgeCandidate } from '../../../caret/widget-edge-snap';
import {
	traceRevealOpen,
	traceRevealFold,
	type RevealFoldReason
} from '../../../debug/interaction-trace';
import { assertInvariant } from '../../../assert';
import type { RevealFold } from '../editable-surface';
import {
	caretIsInTextContent,
	hasModifier,
	isPlainTypingKey,
	surfaceHoldsRange
} from './click-snap-guard';
import {
	findFirstEdgeWidget,
	findLastEdgeWidget,
	rawHasNoTextBefore,
	rawHasNoTextAfter,
	widgetElByStart,
	widgetNodeIn,
	widgetsIn
} from './widget-adjacency';
import type { StoredAs } from '../../../schema/stored-as';
import { replaceRangeInLeaf, type LeafRangeEdit } from '../../../tree-operations/leaf-range';
import type { Reading } from '../../../schema/reading';
import { rangeWrite, withOwnEnding, type TextWrite } from '../surface-write';
import type { DraftRegistry } from '../../draft-registry';
import type { Draft } from '../../../schema/drafts';
import type { ActivationClick, ClickInput } from '../../../activation-click';

const PLAIN_CLICK: ClickInput = { ctrlKey: false, metaKey: false };

export interface WidgetInteractionDeps {
	get node(): NodeView;
	get index(): number;
	get myPath(): number[];
	getEl: () => HTMLElement | null;
	getEditorContentWidth: () => number;
	cursor: SurfaceBackend;
	selection: SelectionState;
	/** The editor's caret writer, for the ranges and the widget selections made here. */
	caretWriter: CaretWriter;
	blockEdit: BlockEditActions;
	/** The block's one write to its own text, for a key over a selected widget. */
	writeText: (write: TextWrite) => ContentWrite;
	focusActions: FocusActions;
	setSnapTarget: (offset: number | null) => void;
	/** Remember a caret offset, counted in the stored bytes, for the restore after the next render. */
	setPendingCursor: (offset: number | null) => void;
	/** The block's live DOM as raw text, read when a shown source is committed, to pick up
	 *  the temporary edit that never went through the CST. */
	readRawText: () => string;
	/** Tells the component a source is showing, so `onInput` and IME `compositionend`
	 *  skip the per-keystroke CST commit while it is. */
	setRevealing: (value: boolean) => void;
	/** Hiding a shown source mid-selection would strand a selection endpoint anchored in it. */
	isCrossBlock: () => boolean;
	/** A shown source is a draft: a `source` swap drops it, and so does a write to its block. */
	drafts: Pick<DraftRegistry, 'open'>;
	/** The grammar the widgets were rendered with, and the presentation mode: reading mode shows
	 *  no source and edits no widget. */
	get reading(): Reading;
	/** Whether a click follows a widget that goes somewhere, rather than showing its source. */
	activationClick: ActivationClick;
	/** Where the block's bytes are stored, read when a selected widget is replaced. */
	storedAs: () => StoredAs;
}

/** The click a widget gesture reads off: the same event the widget's own handler sees. */
export interface WidgetPress {
	/** The click itself, which decides whether a widget that goes somewhere follows it. */
	click?: ClickInput;
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
	/** The block is unmounting: its shown source stops answering the editor's closes. */
	dispose(): void;
	/** Hide a shown source before any edit, so the edit runs against a CST that matches the DOM.
	 *  Null if none was shown; otherwise a write the caller must await before editing. */
	foldRevealBeforeMutation(caretAfter?: number): RevealFold | null;
	/** Hide the source when the caret leaves it but stays inside the block; blur handles
	 *  the case where focus leaves the block. */
	foldRevealIfSelectionEscaped(): void;
	/** The point sits on a widget that can show its source. `pointerdown` then cancels the
	 *  browser's own caret placement so nothing races this one. */
	isPointOnRevealWidget(x: number, y: number): boolean;
	/** Where a press on an inline widget anchors a drag: the widget's raw edge on the point's side.
	 *  Null over no widget, or over one with a pointer gesture of its own. */
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

/** The shown source is tinted with the CSS Custom Highlight API because offset reads need it to
 *  stay a bare text node. Without the API (jsdom, an old browser) it shows untinted. */
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

/** What {@link replaceSelectedWidget} reads. */
export interface WidgetReplaceDeps {
	get node(): NodeView;
	selection: Pick<SelectionState, 'clearWidget'>;
	/** Where the block's bytes are stored, read when the widget is replaced. */
	storedAs: () => StoredAs;
}

/** Replace a selected widget's bytes with `text` in one undoable write, which puts the caret
 *  after `text`: with the widget gone the browser has no caret to keep. */
export async function replaceSelectedWidget(
	deps: WidgetReplaceDeps,
	widget: { start: number; end: number },
	text: string,
	write: (edit: LeafRangeEdit) => ContentWrite
): Promise<void> {
	// The write asks for its caret before its render, so the caret and the bytes land in one flush.
	const written = write(replaceRangeInLeaf(deps.node, widget, text, deps.storedAs()));
	deps.selection.clearWidget();
	await written;
	// The render that places the caret, so a caller awaiting the insert finds the caret there.
	await tick();
}

export function createWidgetInteraction(deps: WidgetInteractionDeps): WidgetInteraction {
	const isReading = () => deps.reading.mode() === 'reading';

	const widgetEditing = (kind: AnyInlineKind) => getInlineWidgetEditing(kind, deps.reading.grammar);
	const characterLike = (kind: AnyInlineKind) => isCharacterLikeWidget(kind, deps.reading.grammar);

	const widgetsOf = (): InlineNode[] => widgetsIn(deps.node, deps.reading);

	// ── Editing a widget's source ──────────────────────────────────────────────
	// The source edit lives only in the DOM and is written on commit, so it lands as one undo entry.
	interface RevealState {
		kernel: SourceReveal;
		/** Trailing-edge fallback for the commit caret when the source node is gone. */
		widgetEnd: number;
		/** Undo anchor: where the caret sat before entry. */
		caretBefore: number;
		/** The displayed text before the edit; a commit with no change touches no CST. */
		originalDisplay: string;
		/** Between showing the source and the caret arriving in it: a `selectionchange` in that gap
		 *  reports the prior selection, not the caret leaving. */
		settling: boolean;
	}
	let revealState: RevealState | null = null;
	let draft: Draft | null = null;

	// Kept outside the record to survive `resetReveal` for the async restore. The exact element
	// is kept because two byte-identical widgets share a pool key, so a lookup could return the other.
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

	// The swap handles are left alone: cancel resets the record before awaiting the restore,
	// which still needs them.
	function resetReveal(): void {
		draft?.end();
		draft = null;
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
		// The wait for the caret spans only microtasks and the synchronous focus dispatch, so a
		// re-entry can only come from this call chain itself (G1.26).
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
			showRendered: restoreRenderedWidget,
			caretWriter: deps.caretWriter
		});
		revealState = {
			kernel,
			widgetEnd: end,
			caretBefore,
			originalDisplay: trimTrailingLineEnding(deps.node.raw),
			settling: true
		};
		draft = deps.drafts.open({
			seed: deps.node.raw,
			current: () => deps.node.raw,
			close: (cause) => {
				if (cause === 'mode-change' && revealState) commitReveal('blur');
			}
		});
		deps.selection.clearWidget();
		deps.setRevealing(true);
		try {
			await kernel.reveal(atSourceOffset);
		} finally {
			// `finally`, not a plain clear: a flag stuck true would disable the escape check for
			// the rest of the block's life. Null-checked, since hiding mid-await already cleared it.
			if (revealState) revealState.settling = false;
		}
	}

	// Always hides, even with nothing to write: a null read as "nothing to wait for" would let a
	// caller splice stale bytes. The caret lands on the source node's current trailing edge.
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
			(el && sourceNode ? rawOffsetAt(el, sourceNode, sourceNode.length) : active.widgetEnd);
		const { caretBefore, originalDisplay } = active;
		const writable = draft?.canWrite() ?? true;
		// The reactive re-render rebuilds the widget, so drop the swap handles without
		// restoring the DOM, then run the teardown.
		if (sourceNode) unwashRevealedSource(sourceNode);
		activeSourceNode = null;
		revealedWidget = null;
		resetReveal();
		// No edit, so no write: a write that changes nothing still pushes an undo entry, and the
		// next Ctrl+Z would spend itself on nothing. A dropped draft writes nothing either.
		if (editedDisplay === originalDisplay || !writable) {
			foldParkedCaret = caretAfter;
			deps.setPendingCursor(caretAfter);
			return { caret: caretAfter, settled: tick() };
		}
		const write = deps.blockEdit.updateBlockContent(
			deps.index,
			withOwnEnding(deps.node, editedDisplay),
			'authored',
			caretBefore,
			caretAfter
		);
		// A refused write leaves the bytes as the reveal found them, where the caret began.
		const caret = write.admitted ? write.caret : caretBefore;
		foldParkedCaret = caret;
		deps.setPendingCursor(caret);
		return { caret, settled: settleWrite(write) };
	}

	// A rejection is swallowed: the commit rethrows only in dev builds, and a dev-only throw must
	// not cancel the gesture in progress.
	async function settleWrite(write: Promise<unknown>): Promise<void> {
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
		// Reset before the await: `replaceWith` fires `selectionchange`, and a live record would
		// let the escape check re-enter mid-swap.
		resetReveal();
		await kernel.commit();
	}

	// No caret is written, because the click that left owns it. A selected range is read in raw
	// offsets and put back after the rebuild, which would otherwise leave its end inside a widget.
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
		return {
			start: rawOffsetAt(el, range.startContainer, range.startOffset),
			end: rawOffsetAt(el, range.endContainer, range.endOffset)
		};
	}

	async function restoreRangeInBlock(span: { start: number; end: number }): Promise<void> {
		await tick();
		const el = deps.getEl();
		if (el) deps.caretWriter.selectRawRange(el, span.start, span.end);
	}

	// Compared by raw offset, bounds included: a caret at the source's edge may sit in the
	// neighbouring text node, which a node comparison would misread as leaving.
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
		const sourceStart = rawOffsetAt(el, activeSourceNode, 0);
		const sourceEnd = sourceStart + activeSourceNode.length;
		const anchorOff = rawOffsetAt(el, anchorNode, sel.anchorOffset);
		const focusOff = rawOffsetAt(el, focusNode, sel.focusOffset);
		const inSource = (o: number) => o >= sourceStart && o <= sourceEnd;
		return !inSource(anchorOff) && !inSource(focusOff);
	}

	// The escape is re-checked after a tick: entering a cross-block selection clears the browser
	// selection before its flag is set. `resetReveal` leaves `foldCheckQueued`, which outlives it.
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

	/** The widget under the pointer, asked of the DOM rather than of a rectangle: a KaTeX render
	 *  draws past its own border box, and `elementFromPoint` counts that overflow. */
	function revealWidgetFromDom(
		el: HTMLElement,
		x: number,
		y: number
	): { inline: InlineNode } | null {
		// jsdom has no hit testing; the rectangle scan in `hitTestRevealWidget` answers there.
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

	/** Where a click on a widget puts the caret when the kind maps no point: the end of its content
	 *  span, inside the delimiters, so typing continues the construct. No span keeps the leading edge. */
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
		// The box test, for a point the DOM cannot answer, such as a synthetic call.

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

	// The target is resolved before hiding the current source, which reflows the line the click was
	// read against, then found again by offset, since a committed edit shifts raw positions.
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
				activeSourceNode === null ? Number.POSITIVE_INFINITY : rawOffsetAt(el, activeSourceNode, 0);
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

	/** Select the whole shown token if the double-click landed on it. Decided from the point: the
	 *  editor root's word-select runs first and may have moved the selection off the source. */
	function selectRevealedSource(x: number, y: number | null): boolean {
		const source = activeSourceNode;
		if (!revealState || !source || y === null) return false;
		const range = document.createRange();
		range.selectNodeContents(source);
		const onSource = Array.from(range.getClientRects()).some(
			(r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
		);
		return onSource && deps.caretWriter.selectDomRange(range);
	}

	function isRevealing(): boolean {
		return revealState !== null;
	}

	// Enter is left to the block's split command, which hides the source before it writes, so one
	// Enter both commits the edit and splits.
	async function handleRevealingKeydown(e: KeyboardEvent): Promise<boolean> {
		if (!revealState) return false;
		if (e.key === 'Escape') {
			e.preventDefault();
			await cancelReveal();
			return true;
		}
		return false;
	}

	// A cross-block drag keeps the source shown, so its rectangles measure real text and no
	// endpoint in it is stranded (`selectionEscapedSource` holds the same rule).
	function commitRevealOnBlur(): void {
		if (revealState && !deps.isCrossBlock()) commitReveal('blur');
	}

	// The committed caret is returned because a caret left on an element-level edge would land a
	// paste at offset 0.
	function foldRevealBeforeMutation(caretAfter?: number): RevealFold | null {
		if (!revealState) return null;
		return commitReveal('commit', caretAfter);
	}

	function isVerticallyTransparent(): boolean {
		// Resolver-free, matching the off-window keyboard-extend path, so the vertical-skip
		// decision is uniform everywhere. Other widget reads stay resolver-aware.
		return isVerticallyTransparentNode(deps.node, deps.reading.grammar);
	}

	// A caret written inside this block rather than through the caret placement entry point:
	// Home and End move on from this edge, so announcing it would report a caret that never stays.
	function leaveWidget(offset: number): void {
		deps.cursor.setRaw(asRawOffset(offset), { clamp: 'reachable' });
		deps.selection.clearWidget();
	}

	async function handleSelectedWidgetKeydown(e: KeyboardEvent): Promise<boolean> {
		const node = deps.node;
		const selectedWidget = deps.selection.widgetIn(deps.myPath);
		if (selectedWidget === null) return false;
		const widget = widgetNodeIn(node, selectedWidget.sourceStart, deps.reading);
		if (widget === null) return false;

		// The kind's editing policy takes its own keys first.
		const consumed = widgetEditing(widget.kind)?.onSelectedKey?.(e, {
			node,
			inline: widget,
			widgetStart: widget.start,
			widgetEnd: widget.end,
			index: deps.index,
			preSelectOffset: selectedWidget.preSelectOffset,
			editorContentWidth: deps.getEditorContentWidth(),
			presentationMode: deps.reading.mode(),
			// The widget stays selected through its own key, so the write leaves the caret alone.
			updateContent: (newRaw, caretBefore, caretAfter) =>
				void deps.writeText({
					...rangeWrite({ raw: newRaw, caret: caretAfter }),
					intent: 'typed',
					mode: 'authored',
					source: 'widget-key',
					sessionAnchor: caretBefore,
					leavesCaret: true
				})
		});
		if (consumed) return true;
		// A modified chord goes on to the keymap dispatch, which owns undo and redo. Arrows stop here:
		// selecting cleared the browser range, so a later handler would read offset 0.
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
				// Ended first: the move can find no block to land in.
				deps.selection.clearWidget();
				await deps.focusActions.moveFocus(deps.index + (left ? -1 : 1), left ? 'end' : 'start');
			} else {
				leaveWidget(left ? widget.start : widget.end);
			}
			return true;
		}
		// A vertical arrow, Home, End and the page keys are shared moves that need a real caret to
		// read: put one at the edge the key leaves from and decline, so the move runs from there.
		const moveEdge = e.shiftKey ? null : caretMoveEdge(e.key);
		if (moveEdge) {
			leaveWidget(moveEdge === 'start' ? widget.start : widget.end);
			return false;
		}
		// Reading mode still consumes the key, since a selected widget owns its keys, but writes
		// nothing.
		const spliceWidget = (text: string): void => {
			if (isReading()) return;
			void replaceSelectedWidget(deps, widget, text, (edit) =>
				deps.writeText({
					...rangeWrite(edit),
					intent: 'typed',
					mode: 'authored',
					source: 'widget',
					sessionAnchor: selectedWidget.preSelectOffset
				})
			);
		};
		if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			spliceWidget('');
			return true;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			leaveWidget(widget.end);
			return true;
		}
		if (isPlainTypingKey(e)) {
			e.preventDefault();
			spliceWidget(e.key);
			return true;
		}
		// Every remaining key is consumed and its default prevented, since the browser's default
		// would still edit behind the CST.
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

	// The one place the show-source-or-select choice is made. `fromTrailingEdge` sets both where
	// the caret goes in the source and the undo anchor.
	function enterWidget(
		widget: { start: number; end: number; kind: AnyInlineKind },
		fromTrailingEdge: boolean
	): void {
		const enteredOffset = fromTrailingEdge ? widget.end : widget.start;
		if (widgetEditing(widget.kind)?.revealSource) {
			const atSourceOffset = fromTrailingEdge ? widget.end - widget.start : 0;
			void startReveal(widget, enteredOffset, atSourceOffset);
		} else {
			selectWidgetWhole(deps.selection, deps.caretWriter, {
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
		const target =
			side === 'start'
				? findFirstEdgeWidget(deps.node, deps.reading)
				: findLastEdgeWidget(deps.node, deps.reading);
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
		// A third click selects the block (`selection/multi-click.ts`), and showing a source under
		// it would place a caret over the range it just painted.
		if (clickY !== null && clickCount < 3) {
			const hit = press.moved ? null : hitTestRevealWidget(el, clickX, clickY);
			if (hit) {
				// Returns rather than falls through: the edge-snap below would focus this block and
				// place a caret, stealing back what the widget's own navigation just landed.
				if (
					widgetActivates(
						widgetEditing(hit.inline.kind),
						press.click ?? PLAIN_CLICK,
						deps.activationClick
					)
				) {
					return;
				}
				void revealFromClick(clickX, clickY);
				return;
			}
		}
		// The first click of a double-click showed the source, and the browser's word rule would take
		// `[` or `$` alone, so the second click selects the whole token.
		if (clickCount === 2 && revealOpenedByLastClick && selectRevealedSource(clickX, clickY)) return;
		// The snap below places a caret, so it does nothing while this block shows a selected
		// range, which it would collapse; `clampOutOfMarkerPrefix` already holds that rule.
		const live = window.getSelection();
		if (surfaceHoldsRange(el, live)) return;
		const seat = nearestWidgetEdgeSeat(measuredWidgets(el), clickX, clickY);
		if (seat === null) return;
		// A click beside a widget leaves a visible caret alone; a click on one cannot, since the
		// browser answers that hit test with a position in the neighbouring text.
		if (!seat.inside && caretIsInTextContent(el, live)) return;
		el.focus();
		deps.cursor.setRaw(asRawOffset(seat.offset), { clamp: 'reachable' });
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

	/** Which inline widgets a drag may start inside: a kind with a pointer gesture of its own (an
	 *  image's resize handles) owns its press. */
	function dragsFromIsland(kind: AnyInlineKind): boolean {
		return characterLike(kind) || widgetEditing(kind)?.revealSource === true;
	}

	function widgetExtensionTarget(key: 'ArrowRight' | 'ArrowLeft'): number | null {
		const el = deps.getEl();
		if (!el) return null;
		const focus = rawSelectionFocus(el);
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
		if (el) deps.caretWriter.extendSelectionToRaw(el, rawOffset);
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
		dispose: () => draft?.end(),
		foldRevealBeforeMutation,
		foldRevealIfSelectionEscaped,
		isPointOnRevealWidget,
		islandDragAnchor
	};
}
