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
import type { SurfaceBackend } from '../editable/surface-backend';
import { selectWidgetWhole } from '../../../selection/place-caret';
import {
	rawSelectionIn,
	rawSelectionFocus,
	caretIsInTextContent,
	liveCaretSpot
} from '../../../browser/selection-read';
import type { SelectionState } from '../../../selection/selection-state.svelte';
import {
	getInlineWidgetEditing,
	isCharacterLikeWidget,
	widgetActivates,
	widgetElByStart
} from '../../../core/inline/inline-widgets';
import { isVerticallyTransparentNode } from '../../../core/inline/transparency';
import { asRawOffset } from '../../../core/coordinate-spaces';
import { rawRangeToDomRange, type RawRange } from '../../../browser/offsets';
import type { CaretClamp, CaretWriter } from '../../../browser/caret-writer';
import { createSourceReveal, type SourceReveal } from '../../../caret/reveal-source';
import {
	nearestWidgetEdgeSeat,
	type WidgetEdgeCandidate,
	type WidgetEdgeSeat
} from '../../../caret/widget-edge-snap';
import type { CaretMemory } from '../../../caret/caret-memory';
import { clickSide, type ClickSide } from './click-side';
import { createNotedPress } from './noted-press';
import {
	traceRevealOpen,
	traceRevealFold,
	type RevealFoldReason
} from '../../../debug/interaction-trace';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { checkWidgetCaretLanding } from '../../../invariants/widget-caret-landing';
import { checkMotionLeftWidget } from '../../../invariants/selected-widget-motion';
import type { RevealFold } from '../editable/surface-clipboard';
import { hasModifier, isPlainTypingKey, surfaceHoldsRange } from './click-snap-guard';
import { caretEdgeKey, pageKey } from '../../../schema/keybindings';
import { elementAtPoint } from '../../../browser/point';
import {
	findFirstEdgeWidget,
	findLastEdgeWidget,
	rawHasNoTextBefore,
	rawHasNoTextAfter,
	widgetNodeIn,
	widgetsIn
} from './widget-adjacency';
import type { StoredAs } from '../../../schema/stored-as';
import { replaceRangeInLeaf, type LeafRangeEdit } from '../../../tree-operations/leaf-range';
import type { Reading } from '../../../schema/reading';
import { rangeWrite, type TextWrite } from '../editable/surface-write';
import type { ShownSourceState } from './shown-source.svelte';
import type { ActivationClick, ClickInput } from '../../../activation-click';
import type { TextMoves } from '../../overlays/text-moves';

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
	/** Closing a shown source mid-selection would strand a selection endpoint anchored in it. */
	isCrossBlock: () => boolean;
	/** The editor's one shown source, which this block's render draws when it is this block's. */
	shownSource: ShownSourceState;
	/** The inline widgets the block's last render drew: what the DOM holds, read without the cache. */
	renderedWidgets: () => InlineNode[];
	/** The grammar the widgets were rendered with, and the presentation mode: reading mode shows
	 *  no source and edits no widget. */
	get reading(): Reading;
	/** Whether a click follows a widget that goes somewhere, rather than showing its source. */
	activationClick: ActivationClick;
	/** Where the block's bytes are stored, read when a selected widget is replaced. */
	storedAs: () => StoredAs;
	/** Told when a click starts the caret fresh (`click-side.ts`), and forgotten when a source
	 *  opens, so no pending mark or break spends itself inside the source. */
	caretMemory: Pick<CaretMemory, 'noteOutside' | 'forget'>;
	/** Puts the caret on the side of a code chip's border a click hit. */
	pinChipSide: (side: 'inside' | 'outside') => void;
	/** Told when a widget shows its source or draws again, since that moves the text after it. */
	textMoves: Pick<TextMoves, 'movedWithin'>;
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
	/** Enter a widget at a caret edge: show its source or select it, as the kind's policy
	 *  says. The caret-edge dispatch decides which edge and calls this. */
	enterWidget(
		widget: { start: number; end: number; kind: AnyInlineKind },
		fromTrailingEdge: boolean
	): void;
	/** Arriving from another block: a widget at the near edge that can show its source
	 *  opens it, any other is selected. Returns whether an edge widget was entered. */
	enterEdgeWidget(side: 'start' | 'end'): boolean;
	/** Read a press at pointerdown, for its click, before anything redraws the line under it. True
	 *  on a widget that shows its source, whose caret is the editor's, not the browser's. */
	notePress(press: Pick<PointerEvent, 'clientX' | 'clientY' | 'button'>): boolean;
	/** The click that ended the noted press: move a caret that landed outside any text node to the
	 *  nearest widget edge, or open the source of a widget the press hit. */
	snapClickToWidgetEdge(press: WidgetPress): void;
	/** Read a point now and return the snap that applies it once a caret is placed there, since
	 *  placing it can close a shown source and redraw the line. */
	readSnapAtPoint(x: number, y: number): () => void;
	/** Put an edit's or an arrival's caret at `offset`. Strictly inside a widget that can show its
	 *  source (a typed `#` before a word) that source opens there; inside any other, it lands past. */
	restoreCaret(offset: number, clamp: CaretClamp): void;
	/** A widget in this block is showing its source. */
	isRevealing(): boolean;
	/** Escape closes a shown source and keeps its bytes. Enter is left alone: it is the block's
	 *  split command, which closes the source first. */
	handleRevealingKeydown(e: KeyboardEvent): Promise<boolean>;
	/** Close the shown source when focus leaves the block. */
	commitRevealOnBlur(): void;
	/** The block is unmounting: its shown source closes with it. */
	dispose(): void;
	/** Close a shown source before a command or a clipboard edit, so it acts on the rendered block.
	 *  Null if none was shown; otherwise the caret it left and the render to await. */
	foldRevealBeforeMutation(caretAfter?: number): RevealFold | null;
	/** Close the source when the caret leaves it but stays inside the block; blur handles
	 *  the case where focus leaves the block. */
	foldRevealIfSelectionEscaped(): void;
	/** Where a press on an inline widget anchors a drag: the widget's raw edge on the point's side.
	 *  Null over no widget, or over one with a pointer gesture of its own. */
	islandDragAnchor(x: number, y: number): number | null;
}

/** How a key that moves or extends the caret leaves a selected widget. */
interface CaretMotion {
	/** The widget edge the key moves toward. */
	side: 'start' | 'end';
	extend: boolean;
	/** The Cmd+Arrow line-edge spelling, which the browser moves for on macOS only. */
	lineArrow: boolean;
}

/** The caret motion a key on a selected widget asks for, or null for any other key; Shift+Left and
 *  Shift+Right are the widget kind's, and a plain Left or Right steps out by its own rule. */
function caretMotionOf(e: KeyboardEvent): CaretMotion | null {
	const edge = caretEdgeKey(e);
	if (edge) {
		const line = edge.to === 'line';
		return {
			side: edge.side,
			extend: edge.to === 'doc' || (line && edge.extend),
			lineArrow: line && edge.arrow
		};
	}
	if (hasModifier(e)) return null;
	const page = pageKey(e);
	if (page) {
		return {
			side: page.direction === 'up' ? 'start' : 'end',
			extend: page.extend,
			lineArrow: false
		};
	}
	const side = e.key === 'ArrowUp' ? 'start' : e.key === 'ArrowDown' ? 'end' : null;
	return side && { side, extend: e.shiftKey, lineArrow: false };
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

	// ── Showing a widget's source ──────────────────────────────────────────────
	// The shown source is render state: the block draws the range as its bytes and keys take the
	// ordinary typed write, so the bytes are always current and closing it writes nothing.
	interface Showing {
		kernel: SourceReveal;
		/** Between opening and the caret arriving: a `selectionchange` in that gap reports the
		 *  prior selection, not the caret leaving. */
		settling: boolean;
	}
	let showing: Showing | null = null;
	// The caret a close left behind, which may lie inside the widget drawn again: the restore must
	// not read it as a widget closing around the caret and open it again.
	let foldParkedCaret: number | null = null;

	const shownRange = (): RawRange | null => deps.shownSource.rangeIn(deps.myPath, deps.node);

	// Every close is private to this module and checked by all its callers, so closing with none
	// shown means a caller skipped the check or a flag leaked (G1.26).
	function assertCloseTargetsShownSource(entry: string): void {
		assertInvariant('reveal-transition', () =>
			showing ? null : { code: 'fold-without-reveal', message: `${entry} with no active reveal` }
		);
	}

	async function startReveal(
		widget: { start: number; end: number },
		atSourceOffset = 0
	): Promise<void> {
		// Every way in comes through here, so this is the only reading-mode check needed.
		if (isReading()) return;
		// The wait for the caret spans only microtasks and the synchronous focus dispatch, so a
		// re-entry can only come from this call chain itself (G1.26).
		assertInvariant('reveal-transition', () =>
			showing?.settling
				? {
						code: 'start-during-settle',
						message: 'startReveal re-entered inside the reveal settle window'
					}
				: null
		);
		if (showing) return;
		traceRevealOpen('inline');
		const { start, end } = widget;
		const kernel = createSourceReveal({
			get container() {
				return deps.getEl();
			},
			get sourceStart() {
				return start;
			},
			get sourceEnd() {
				return shownRange()?.end ?? end;
			},
			get source() {
				return deps.node.raw.slice(start, shownRange()?.end ?? end);
			},
			isRevealed: () => shownRange() !== null,
			showSource: () => {
				deps.shownSource.open(deps.myPath, deps.node, { start, end });
				noteTextMoved();
			},
			showRendered: () => closeRange(),
			caretWriter: deps.caretWriter
		});
		showing = { kernel, settling: true };
		deps.selection.clearWidget();
		deps.caretMemory.forget();
		try {
			await kernel.reveal(atSourceOffset);
		} finally {
			// `finally`, not a plain clear: a flag stuck true would disable the escape check for
			// the rest of the block's life. Null-checked, since a close mid-await already cleared it.
			if (showing) showing.settling = false;
		}
	}

	function noteTextMoved(): void {
		const el = deps.getEl();
		if (el) deps.textMoves.movedWithin(el);
	}

	function closeRange(): void {
		showing = null;
		deps.shownSource.close(deps.myPath);
		noteTextMoved();
	}

	// `caret` is where the caret goes once the widget draws again, or null where the gesture that
	// closed the source owns the caret (a click, a blur, the caret already outside).
	function closeShownSource(reason: RevealFoldReason, caret: number | null): RevealFold | null {
		assertCloseTargetsShownSource('closeShownSource');
		if (!showing) return null;
		traceRevealFold(reason);
		const span = caret === null ? liveRangeInBlock() : null;
		closeRange();
		if (caret === null) {
			// The rebuild would collapse a range over the block, whose raw offsets still hold.
			if (span) void restoreRangeInBlock(span);
			return { caret: deps.cursor.getRaw() ?? 0, settled: tick() };
		}
		foldParkedCaret = caret;
		deps.setPendingCursor(caret);
		return { caret, settled: tick() };
	}

	/** The live selection in raw offsets, when it is a range with both ends inside this block. */
	function liveRangeInBlock(): { start: number; end: number } | null {
		const el = deps.getEl();
		const live = el && rawSelectionIn(el);
		if (!live || live.collapsed || live.start === null || live.end === null) return null;
		return { start: live.start, end: live.end };
	}

	async function restoreRangeInBlock(span: { start: number; end: number }): Promise<void> {
		await tick();
		const el = deps.getEl();
		if (el) deps.caretWriter.selectRawRange(el, span.start, span.end);
	}

	// Compared by raw offset, bounds included: a caret at the source's edge is still in it.
	function selectionEscapedSource(): boolean {
		if (!showing || showing.settling) return false;
		if (deps.isCrossBlock()) return false;
		const range = shownRange();
		// The block changed kind under the source, so nothing is shown any more.
		if (!range) return true;
		const el = deps.getEl();
		const live = el && rawSelectionIn(el);
		if (!live || live.start === null || live.end === null) return false;
		const inSource = (o: number) => o >= range.start && o <= range.end;
		return !inSource(live.start) && !inSource(live.end);
	}

	// The escape is re-checked after a tick: entering a cross-block selection clears the browser
	// selection before its flag is set. A close leaves `foldCheckQueued`, which outlives it.
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
			if (selectionEscapedSource()) closeShownSource('selection-escape', null);
		})();
	}

	/** The widget under the pointer, asked of the DOM since a KaTeX render draws past its box;
	 *  jsdom finds no element, and the rectangle scan in `hitTestRevealWidget` answers there. */
	function revealWidgetFromDom(
		el: HTMLElement,
		x: number,
		y: number
	): { inline: InlineNode } | null {
		const at = elementAtPoint(el.ownerDocument, x, y);
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

	/** The offset a point names inside a widget's source, against the layout the widget draws in. */
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

	function islandDragAnchor(x: number, y: number): number | null {
		const el = deps.getEl();
		if (!el) return null;
		const seat = nearestWidgetEdgeSeat(measuredWidgets(el, dragsFromIsland), x, y);
		return seat?.inside ? seat.offset : null;
	}

	// ── What a press means ─────────────────────────────────────────────────────
	// Every read of the point happens here, at the press: by the click, the press itself may have
	// moved the caret out of a shown source, which closes it and reflows the line under the point.

	interface PressReading {
		/** A widget under the point that shows its source, and the source offset the point names. */
		reveal: { inline: InlineNode; seat: number | null } | null;
		/** The point is on the shown source's text: a double-click's second press selects it. */
		onShownSource: boolean;
		/** What the press means at a hidden edge, for a press that doesn't travel. */
		side: ClickSide;
		edgeSeat: WidgetEdgeSeat | null;
	}

	function readPress(el: HTMLElement, x: number, y: number): PressReading {
		const hit = hitTestRevealWidget(el, x, y);
		return {
			reveal: hit && { inline: hit.inline, seat: seatFromPoint(el, hit.inline, x, y) },
			onShownSource: pointOnShownSource(el, x, y),
			side: clickSide(el, x, y, false),
			edgeSeat: nearestWidgetEdgeSeat(measuredWidgets(el), x, y)
		};
	}

	function pointOnShownSource(el: HTMLElement, x: number, y: number): boolean {
		const shown = shownRange();
		const range = showing && shown && rawRangeToDomRange(el, shown.start, shown.end);
		if (!range) return false;
		return Array.from(range.getClientRects()).some(
			(r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
		);
	}

	const notedPress = createNotedPress<PressReading>();

	function notePress(press: Pick<PointerEvent, 'clientX' | 'clientY' | 'button'>): boolean {
		const el = deps.getEl();
		if (!el) return false;
		const reading = readPress(el, press.clientX, press.clientY);
		// Only a primary press ends in the click that reads it.
		if (press.button === 0) notedPress.note(reading, el);
		return reading.reveal !== null;
	}

	function readSnapAtPoint(x: number, y: number): () => void {
		const el = deps.getEl();
		const reading = el && readPress(el, x, y);
		return () => snapToPress(reading, {});
	}

	// Selecting the whole token belongs to the double-click that opened the source, and nothing
	// in the second click's own shape tells it apart from a later one inside that source.
	let revealOpenedByLastClick = false;

	// Closing the current source writes nothing, so the offsets the press read still hold after.
	function revealFromPress(el: HTMLElement, reveal: NonNullable<PressReading['reveal']>): void {
		// Not awaited: a caret the click lands meanwhile would open the target first.
		if (showing) closeShownSource('no-edit', null);
		const target = widgetsOf().find(
			(n) => n.start === reveal.inline.start && widgetEditing(n.kind)?.revealSource
		);
		if (!target) return;
		el.focus({ preventScroll: true });
		revealOpenedByLastClick = true;
		void startReveal(target, reveal.seat ?? insideEndOffset(target));
	}

	function isRevealing(): boolean {
		return showing !== null;
	}

	// The caret stays where it was, which the widget drawn again turns into its far edge.
	async function handleRevealingKeydown(e: KeyboardEvent): Promise<boolean> {
		if (!showing || e.key !== 'Escape') return false;
		e.preventDefault();
		await closeShownSource('cancel', deps.cursor.getRaw())?.settled;
		return true;
	}

	// A cross-block drag keeps the source shown, so its rectangles measure real text and no
	// endpoint in it is stranded (`selectionEscapedSource` holds the same rule).
	function commitRevealOnBlur(): void {
		if (showing && !deps.isCrossBlock()) closeShownSource('blur', null);
	}

	// The caret is returned because a caret left on an element-level edge would land a paste at
	// offset 0.
	function foldRevealBeforeMutation(caretAfter?: number): RevealFold | null {
		if (!showing) return null;
		return closeShownSource('commit', caretAfter ?? deps.cursor.getRaw() ?? 0);
	}

	function isVerticallyTransparent(): boolean {
		// Resolver-free, matching the off-window keyboard-extend path, so the vertical-skip
		// decision is uniform everywhere. Other widget reads stay resolver-aware.
		return isVerticallyTransparentNode(deps.node, deps.reading);
	}

	// A caret written inside this block rather than through the caret placement entry point:
	// Home and End move on from this edge, so announcing it would report a caret that never stays.
	function leaveWidget(offset: number): void {
		deps.cursor.setRaw(asRawOffset(offset), { clamp: 'reachable' });
		deps.selection.clearWidget();
	}

	// The move runs after the widget declines the key, so it needs a real selection to read: a caret
	// at the edge the key moves toward, or for an extend the widget as a range anchored at its far edge.
	function leaveWidgetBy(motion: CaretMotion, widget: { start: number; end: number }): void {
		const [near, far] =
			motion.side === 'start' ? [widget.start, widget.end] : [widget.end, widget.start];
		const el = deps.getEl();
		if (!motion.extend || !el) {
			leaveWidget(near);
			return;
		}
		deps.caretWriter.selectRawRange(el, far, near);
		deps.selection.clearWidget();
	}

	async function handleSelectedWidgetKeydown(e: KeyboardEvent): Promise<boolean> {
		const handled = await keydownOnSelectedWidget(e);
		if (!handled) {
			assertInvariant('selected-widget-motion', () =>
				checkMotionLeftWidget(
					e.key,
					caretMotionOf(e) !== null,
					deps.selection.widgetIn(deps.myPath) !== null
				)
			);
		}
		return handled;
	}

	async function keydownOnSelectedWidget(e: KeyboardEvent): Promise<boolean> {
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
					...rangeWrite(node, { raw: newRaw, caret: caretAfter }),
					intent: 'typed',
					history: 'join-typing',
					mode: 'authored',
					source: 'widget-key',
					sessionAnchor: caretBefore,
					leavesCaret: true
				})
		});
		if (consumed) return true;
		const motion = caretMotionOf(e);
		if (motion) {
			leaveWidgetBy(motion, widget);
			// The browser moves for Cmd+Arrow on macOS only, so the line edge is placed here.
			if (motion.lineArrow) {
				e.preventDefault();
				if (motion.extend) deps.caretWriter.extendToLineEdge(motion.side);
				else deps.caretWriter.moveCaretToLineEdge(motion.side);
			}
			return false;
		}
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
		// Reading mode still consumes the key, since a selected widget owns its keys, but writes
		// nothing.
		const spliceWidget = (text: string): void => {
			if (isReading()) return;
			void replaceSelectedWidget(deps, widget, text, (edit) =>
				deps.writeText({
					...rangeWrite(deps.node, edit),
					intent: 'typed',
					history: 'join-typing',
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

	// The one place the show-source-or-select choice is made. `fromTrailingEdge` sets both where
	// the caret goes in the source and the undo anchor.
	function enterWidget(
		widget: { start: number; end: number; kind: AnyInlineKind },
		fromTrailingEdge: boolean
	): void {
		const enteredOffset = fromTrailingEdge ? widget.end : widget.start;
		if (widgetEditing(widget.kind)?.revealSource) {
			void startReveal(widget, fromTrailingEdge ? widget.end - widget.start : 0);
		} else {
			selectWidgetWhole(deps.selection, deps.caretWriter, {
				paragraphPath: deps.myPath,
				sourceStart: widget.start,
				preSelectOffset: enteredOffset
			});
		}
	}

	// A shown source stays open while the caret lands inside it and the block keeps its kind; a
	// close's own parked caret is left where it is, beside the widget just drawn again.
	function restoreCaret(offset: number, clamp: CaretClamp): void {
		const parkedByFold = foldParkedCaret === offset;
		foldParkedCaret = null;
		// A source still opening places its own caret once drawn.
		if (showing?.settling) return;
		if (showing) {
			if (deps.shownSource.holds(deps.myPath, deps.node, offset)) {
				deps.cursor.setRaw(asRawOffset(offset), { clamp: 'exact' });
				return;
			}
			traceRevealFold('caret-exit');
			closeRange();
		}
		if (!parkedByFold && revealInterior(offset)) return;
		deps.cursor.setRaw(asRawOffset(offset), { clamp });
		if (parkedByFold) return;
		assertInvariant('widget-caret-landing', () =>
			checkWidgetCaretLanding(
				offset,
				deps.cursor.getRaw(),
				deps.renderedWidgets().map((w) => ({
					start: w.start,
					end: w.end,
					kind: w.kind,
					showsSource: !isReading() && widgetEditing(w.kind)?.revealSource === true
				}))
			)
		);
	}

	// A kind with no content span edits its whole source. Inside a span only: a formula's caret
	// stays between its delimiters.
	function revealInterior(offset: number): boolean {
		if (showing || isReading()) return false;
		const widget = deps.renderedWidgets().find((w) => w.start < offset && offset < w.end);
		if (!widget) return false;
		const editing = widgetEditing(widget.kind);
		if (!editing?.revealSource) return false;
		const source = deps.node.raw.slice(widget.start, widget.end);
		const at = offset - widget.start;
		const span = editing.revealContentSpan
			? editing.revealContentSpan(source)
			: { start: 0, end: source.length };
		if (!span || at < span.start || at > span.end) return false;
		void startReveal(widget, at);
		return true;
	}

	function enterEdgeWidget(side: 'start' | 'end'): boolean {
		const target =
			side === 'start'
				? findFirstEdgeWidget(deps.node, deps.reading)
				: findLastEdgeWidget(deps.node, deps.reading);
		if (!target) return false;
		// Focus the contenteditable so subsequent keys route to this block's handler.
		deps.getEl()?.focus({ preventScroll: true });
		enterWidget(target, side === 'end');
		return true;
	}

	function snapClickToWidgetEdge(press: WidgetPress): void {
		// A click with no press of its own (the keyboard's, a scripted one) reads nothing.
		if (press.clickCount === 0) {
			deps.setSnapTarget(null);
			return;
		}
		snapToPress(notedPress.take(), press);
	}

	function snapToPress(reading: PressReading | null, press: WidgetPress): void {
		deps.setSnapTarget(null);
		const clickCount = press.clickCount ?? 1;
		// Every double-click starts with a single click, so that first click is where the flag
		// is set and any flag left over from an earlier gesture is cleared.
		if (clickCount === 1) revealOpenedByLastClick = false;
		const el = deps.getEl();
		if (!el || !reading) return;
		// A third click selects the block (`selection/multi-click.ts`), and showing a source under
		// it would place a caret over the range it just painted.
		if (reading.reveal && clickCount < 3 && !press.moved) {
			// Returns rather than falls through: the edge-snap below would focus this block and
			// place a caret, stealing back what the widget's own navigation just landed.
			const editing = widgetEditing(reading.reveal.inline.kind);
			if (widgetActivates(editing, press.click ?? PLAIN_CLICK, deps.activationClick)) return;
			revealFromPress(el, reading.reveal);
			return;
		}
		// The first click of a double-click showed the source, and the browser's word rule would take
		// `[` or `$` alone, so the second click selects the whole token.
		if (clickCount === 2 && revealOpenedByLastClick && selectShownSource(el, reading)) return;
		// The snap below places a caret, so it does nothing while this block shows a selected
		// range, which it would collapse; `clampOutOfMarkerPrefix` already holds that rule.
		if (surfaceHoldsRange(el)) return;
		const side = press.moved ? null : reading.side;
		if (side === 'fresh') deps.caretMemory.noteOutside();
		else if (side) deps.pinChipSide(side === 'chip-inside' ? 'inside' : 'outside');
		const seat = reading.edgeSeat;
		if (seat === null) return;
		// A click beside a widget leaves a visible caret alone, unless a widget on the click's line
		// separates the two (Firefox puts a click past a run in the text before it); one on it can't.
		if (
			!seat.inside &&
			caretIsInTextContent(el) &&
			!(seat.onRow && widgetSeparates(el, seat.offset))
		) {
			return;
		}
		el.focus({ preventScroll: true });
		deps.cursor.setRaw(asRawOffset(seat.offset), { clamp: 'reachable' });
		// Text shows its own caret, and beside a picture the caret writer already asked for the bar.
		const spot = liveCaretSpot(el);
		if (spot !== 'text' && spot !== 'widget-block') deps.setSnapTarget(seat.offset);
	}

	/** Select the whole shown token, decided from the press: the editor root's word-select runs
	 *  first and may have moved the selection off the source. */
	function selectShownSource(el: HTMLElement, reading: PressReading): boolean {
		const shown = shownRange();
		if (!showing || !shown || !reading.onShownSource) return false;
		return deps.caretWriter.selectRawRange(el, shown.start, shown.end);
	}

	/** Whether a widget lies whole between the live caret and the widget edge a click is nearest. */
	function widgetSeparates(el: HTMLElement, seat: number): boolean {
		const caret = rawSelectionFocus(el);
		if (caret === null) return false;
		const [from, to] = caret < seat ? [caret, seat] : [seat, caret];
		return widgetsOf().some((widget) => from <= widget.start && widget.end <= to);
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

	return {
		isVerticallyTransparent,
		handleSelectedWidgetKeydown,
		enterWidget,
		restoreCaret,
		enterEdgeWidget,
		notePress,
		snapClickToWidgetEdge,
		readSnapAtPoint,
		isRevealing,
		handleRevealingKeydown,
		commitRevealOnBlur,
		dispose: () => {
			notedPress.dispose();
			if (showing) closeRange();
		},
		foldRevealBeforeMutation,
		foldRevealIfSelectionEscaped,
		islandDragAnchor
	};
}
