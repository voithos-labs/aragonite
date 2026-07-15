/**
 * Inline-widget interaction for TextEditableBlock: keyboard handling of a
 * selected widget (step-out, delete, replace, plus kind-specific keys routed to
 * its editing policy — e.g. image resize), shift-arrow entry into a widget,
 * caret-adjacent widget selection/typing, and click-to-snap against a widget's
 * edges. The component owns the contenteditable, the $effect wiring, and the
 * `$state` snap target; this owns the offset math and the handler bodies that
 * branch off keydown/click.
 *
 * Each keydown sub-handler returns whether it consumed the event, so the
 * component can interleave them with the shared keydown pipeline.
 */

import { tick } from 'svelte';
import type { BlockEditActions, FocusActions } from '../../../action-contracts';
import type { AnyInlineKind, CstNode, InlineNode } from '../../../core/nodes';
import type { LinkReferenceResolverRef } from '../../../editor-keys';
import type { WidgetSelectionState } from '../../image/widget-selection-state.svelte';
import type { AmbientCursorIO } from '../../../ambient/ambient-cursor';
import { getInlineContent } from '../../../core/inline/inline-cache';
import {
	isInlineWidget,
	flattenInlineWidgets,
	getInlineWidgetEditing
} from '../../../core/inline/inline-widgets';
import { isVerticallyTransparentNode } from '../../../core/inline/transparency';
import { trimTrailingLineEnding } from '../../../core/lines';
import {
	asRawOffset,
	toClampedRawOffset,
	toDomTextOffset,
	type RawOffset
} from '../../../cursor/coordinate-spaces';
import { domTextOffsetAtNode, createRangeAtDomTextOffsets } from '../../../cursor/widget-offset';
import { createSourceReveal, type SourceReveal } from '../../../cursor/reveal-source';
import { caretIsInTextContent } from './click-snap-guard';
import {
	widgetAtCursor,
	findWidgetNodeByStart,
	findFirstEdgeWidget,
	findLastEdgeWidget,
	rawHasNoTextBefore,
	rawHasNoTextAfter
} from './widget-adjacency';

export interface WidgetInteractionDeps {
	get node(): CstNode;
	get index(): number;
	get myPath(): number[];
	getEl: () => HTMLElement | null;
	getAmbientLength: () => number;
	getEditorContentWidth: () => number;
	cursor: AmbientCursorIO;
	widgetSelection: WidgetSelectionState;
	blockEdit: BlockEditActions;
	focusActions: FocusActions;
	getSnapTarget: () => number | null;
	setSnapTarget: (offset: number | null) => void;
	setPendingCursor: (offset: number | null) => void;
	/** The block's live DOM read as raw text (widget-aware). Read on reveal commit
	 *  to pick up the ephemeral source edit that never went through the CST. */
	readRawText: () => string;
	/** Mirror the reveal-active state into the component so `onInput` (and IME
	 *  compositionend) suppress the per-keystroke CST commit while source is shown. */
	setRevealing: (value: boolean) => void;
	/** A selection currently spans block boundaries — folding a revealed source
	 *  mid-selection would strand an endpoint anchored in it. */
	isCrossBlock: () => boolean;
	get linkRef(): LinkReferenceResolverRef | undefined;
}

export interface WidgetInteraction {
	/** Block has only image/blank inline content — vertical arrow traversal
	 *  skips it because the widgets carry no column meaning. */
	isVerticallyTransparent(): boolean;
	/** Keydown while a widget is selected. Resolves true once the widget is
	 *  confirmed here — every key is consumed in that state, so the caller must
	 *  not fall through to the shared pipeline. */
	handleSelectedWidgetKeydown(e: KeyboardEvent): Promise<boolean>;
	/** Shift+Arrow stepping into a widget; extends the native selection to the
	 *  far boundary atomically. */
	handleShiftArrowIntoWidget(e: KeyboardEvent): boolean;
	/** Plain Arrow/Delete/typing while the caret sits against a widget edge. */
	handleWidgetAtCursorKeydown(e: KeyboardEvent, effectiveOffset: RawOffset | null): boolean;
	/** Cross-block edge landing: a reveal-capable widget at the near edge opens its
	 *  source reveal; any other widget is selected (image overlay). Returns whether
	 *  an edge widget was entered. */
	enterEdgeWidget(side: 'start' | 'end'): boolean;
	/** Snap a click that landed outside any text node to the nearest widget edge. */
	snapClickToWidgetEdge(clickX: number | null, clickY: number | null): void;
	/** A reveal-source widget currently shows its editable `$…$` source. */
	isRevealing(): boolean;
	/** Escape (cancel to rendered) / Enter (commit + re-render) while source is shown. */
	handleRevealingKeydown(e: KeyboardEvent): Promise<boolean>;
	/** Commit the revealed source when focus leaves the block. */
	commitRevealOnBlur(): void;
	/** While source is revealed, fold when the caret/selection escapes it but
	 *  stays inside the block (blur owns the focus-leaving fold). */
	foldRevealIfSelectionEscaped(): void;
	/** The point sits on a reveal-source widget — pointerdown uses this to
	 *  preventDefault the browser's caret task so nothing races the reveal's
	 *  own placement. */
	isPointOnRevealWidget(x: number, y: number): boolean;
}

export function createWidgetInteraction(deps: WidgetInteractionDeps): WidgetInteraction {
	// Resolver-aware so widget detection matches the render path's view — a
	// mismatch around reference-style image widgets breaks cursor/clipboard.
	function inlinesOf(node: CstNode): InlineNode[] {
		return getInlineContent(node, deps.linkRef?.current, deps.linkRef?.signature ?? '');
	}

	function isTypingKey(e: KeyboardEvent): boolean {
		if (e.ctrlKey || e.metaKey || e.altKey) return false;
		return e.key.length === 1;
	}

	// ── Reveal-source editing ──────────────────────────────────────────────────
	// A reveal-source widget (inline math) swaps its rendered island for editable
	// `$…$` source. The edit is ephemeral DOM only — `onInput` is suppressed while
	// revealed — and re-renders on commit, not per keystroke (design spec A2). The
	// whole edit therefore lands as ONE undo entry.
	let activeReveal: SourceReveal | null = null;
	// The revealed source text node, hoisted out of startReveal so commitReveal can
	// read its live DOM position — the widget's post-edit trailing edge — regardless
	// of edits made to the surrounding prose. Doubles as the revealed-state flag.
	let activeSourceNode: Text | null = null;
	let revealWidgetEnd = 0;
	let revealCaretBefore = 0;
	let revealOriginalDisplay = '';
	// The element the swap detaches, restored VERBATIM on cancel/fold. Identity is
	// load-bearing: two byte-identical widgets share a reuse-pool key, so any
	// rebuild-by-lookup can return the OTHER live instance — and replaceWith
	// would MOVE it, vacating its slot and desyncing DOM from CST. Only the
	// captured element is guaranteed to be the one this reveal swapped out.
	let revealedWidget: HTMLElement | null = null;
	// The swap window between showSource and the kernel's caret landing: a
	// selectionchange delivered inside it reads a pre-reveal selection and must
	// not be mistaken for an escape.
	let revealSettling = false;

	function restoreRenderedWidget(): void {
		if (activeSourceNode === null || revealedWidget === null) return;
		activeSourceNode.replaceWith(revealedWidget);
		activeSourceNode = null;
		revealedWidget = null;
	}

	async function startReveal(
		widget: { start: number; end: number },
		caretBefore: number,
		atSourceOffset = 0
	): Promise<void> {
		if (activeReveal) return;
		const start = widget.start;
		const end = widget.end;
		const source = deps.node.raw.slice(start, end);
		// The imperative span-swap IS the inline mechanism: replace the opaque
		// [data-inline-widget] island with a text node and back.
		const reveal = createSourceReveal({
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
				const widget = container.querySelector<HTMLElement>(
					`[data-inline-widget][data-source-start="${start}"]`
				);
				if (!widget) return;
				revealedWidget = widget;
				activeSourceNode = document.createTextNode(source);
				widget.replaceWith(activeSourceNode);
			},
			// Cancel re-inserts the exact element the swap detached — the edit is
			// discarded and the raw unchanged, so it is still current. The persist
			// path re-renders reactively instead, so this fires on Escape and the
			// no-edit click-away fold.
			showRendered: restoreRenderedWidget
		});
		activeReveal = reveal;
		revealWidgetEnd = end;
		revealCaretBefore = caretBefore;
		revealOriginalDisplay = trimTrailingLineEnding(deps.node.raw);
		deps.widgetSelection.clear();
		deps.setRevealing(true);
		// finally, not a plain clear: a wedged-true flag would disable the escape
		// fold for the rest of the block's life.
		revealSettling = true;
		try {
			await reveal.reveal(atSourceOffset);
		} finally {
			revealSettling = false;
		}
	}

	// Persist the ephemeral source edit, or fold back untouched. The reactive
	// re-render (forced by the pending-cursor set) is what re-renders the widget —
	// "commit re-renders" without the imperative swap — so the CST holds the edit
	// for serialize/undo. The caret lands on the math's new trailing edge, read from
	// the revealed source node's live position so an edit to the surrounding prose
	// shifts it correctly (a length delta off the widget's old end would not).
	function commitReveal(): void {
		if (!activeReveal) return;
		// Sibling of editable-leaf's `commitReveal`: a cross-block selection sweeping
		// through keeps the source revealed so its rects measure real text, not a
		// folded island — folding now would strand a selection endpoint anchored in
		// the source text node.
		if (deps.isCrossBlock()) return;
		const el = deps.getEl();
		const sourceNode = activeSourceNode;
		const editedDisplay = deps.readRawText();
		const caretAfter =
			el && sourceNode
				? toClampedRawOffset(
						domTextOffsetAtNode(el, sourceNode, sourceNode.length),
						deps.getAmbientLength()
					)
				: revealWidgetEnd;
		activeReveal = null;
		activeSourceNode = null;
		deps.setRevealing(false);
		// No edit: fold back to rendered without touching the CST. A zero-diff
		// updateBlockContent still pushes a dead undo entry (the debounced snapshot
		// fires before the noop reparse bails), so the user's next Ctrl+Z would
		// revert nothing instead of their prior action. setPendingCursor re-renders
		// from the untouched CST — folding the span-swap — and its caret restore is
		// focus-guarded, so a blur folds without yanking the caret back.
		if (editedDisplay === revealOriginalDisplay) {
			deps.setPendingCursor(caretAfter);
			return;
		}
		deps.blockEdit.updateBlockContent(
			deps.index,
			editedDisplay + '\n',
			revealCaretBefore,
			caretAfter
		);
		deps.setPendingCursor(caretAfter);
	}

	// Cancel: discard the ephemeral edit, imperatively rebuilding the original
	// widget from the untouched raw (CST-free view toggle — no undo entry).
	async function cancelReveal(): Promise<void> {
		if (!activeReveal) return;
		const reveal = activeReveal;
		activeReveal = null;
		deps.setRevealing(false);
		await reveal.commit();
	}

	// Click-away fold for an UNEDITED reveal: restore the widget synchronously and
	// write no caret — the escaping click owns the caret, and the kernel commit's
	// trailing-edge placement would hijack it.
	function foldRevealNoEdit(): void {
		if (!activeReveal) return;
		activeReveal = null;
		deps.setRevealing(false);
		restoreRenderedWidget();
	}

	// The selection currently reads as an escape: both endpoints in the block,
	// neither in the revealed source. Containment is decided by RAW OFFSET through
	// the canonical walk, boundary-inclusive: a caret at the source's edge may
	// anchor in the ADJACENT text node (the browser's choice), and node identity
	// would misread that as an escape.
	function selectionEscapedSource(): boolean {
		if (!activeReveal || !activeSourceNode || revealSettling) return false;
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

	// Escape fold: while source is revealed, a caret/selection move that leaves the
	// source but stays inside the block folds the reveal (clean → widget restored
	// in place; edited → the commit path, one undo entry). Blur keeps owning the
	// focus-leaving fold; a cross-block sweep keeps the source revealed so its
	// rects measure real text. An escape must SURVIVE A TICK to fold: the editor's
	// own machinery (cross-block entry clearing the native selection for custom
	// rendering) manufactures transient escape-shaped states that a slow machine
	// delivers before the cross-block flag flips — re-verifying after tick makes
	// them unfoldable while a real user escape still folds.
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
			if (!selectionEscapedSource()) return;
			if (deps.readRawText() === revealOriginalDisplay) {
				foldRevealNoEdit();
				return;
			}
			commitReveal();
		})();
	}

	// Point-in-rect walk over the block's reveal-source widgets — the ONE hit test
	// the pointerdown ownership probe, the click dispatch, and the post-fold
	// re-resolve all share.
	function hitTestRevealWidget(
		el: HTMLElement,
		x: number,
		y: number
	): { inline: InlineNode } | null {
		for (const inline of inlinesOf(deps.node)) {
			if (!isInlineWidget(inline, deps.node.raw)) continue;
			if (!getInlineWidgetEditing(inline.kind)?.revealSource) continue;
			const widget = el.querySelector(
				`[data-inline-widget][data-source-start="${inline.start}"]`
			) as HTMLElement | null;
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

	// A click on a reveal-source widget is ONE owned gesture: resolve the target
	// BEFORE folding (the fold shifts layout, so the click point only means
	// something against pre-fold geometry), fold any active reveal (clean →
	// in-place restore; edited → commit + settle), then re-locate the target by
	// OFFSET — an edited commit shifts raw positions by its length delta. The
	// pointerdown preventDefault already suppressed the browser's caret task, so
	// nothing races the kernel's placement.
	async function revealFromClick(clickX: number, clickY: number): Promise<void> {
		const el = deps.getEl();
		if (!el) return;
		const hit = hitTestRevealWidget(el, clickX, clickY);
		if (!hit) return;
		let targetStart = hit.inline.start;
		if (activeReveal) {
			const revealedStart =
				activeSourceNode === null
					? Number.POSITIVE_INFINITY
					: toClampedRawOffset(
							domTextOffsetAtNode(el, activeSourceNode, 0),
							deps.getAmbientLength()
						);
			const rawBefore = deps.node.raw.length;
			if (deps.readRawText() === revealOriginalDisplay) {
				foldRevealNoEdit();
			} else {
				commitReveal();
				await tick();
				if (revealedStart < targetStart) targetStart += deps.node.raw.length - rawBefore;
			}
		}
		const target = inlinesOf(deps.node).find(
			(n) =>
				n.start === targetStart &&
				isInlineWidget(n, deps.node.raw) &&
				getInlineWidgetEditing(n.kind)?.revealSource
		);
		if (!target) return;
		el.focus();
		// A click can't map to a source glyph — land at the leading edge (offset 0).
		void startReveal(target, target.start, 0);
	}

	function isRevealing(): boolean {
		return activeReveal !== null;
	}

	async function handleRevealingKeydown(e: KeyboardEvent): Promise<boolean> {
		if (!activeReveal) return false;
		if (e.key === 'Escape') {
			e.preventDefault();
			await cancelReveal();
			return true;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			commitReveal();
			return true;
		}
		return false;
	}

	function commitRevealOnBlur(): void {
		if (activeReveal) commitReveal();
	}

	function isVerticallyTransparent(): boolean {
		// Resolver-free, matching the off-window keyboard-extend path: the
		// vertical-skip decision is uniform everywhere. The other widget reads
		// below stay resolver-aware (parity with render).
		return isVerticallyTransparentNode(deps.node);
	}

	async function handleSelectedWidgetKeydown(e: KeyboardEvent): Promise<boolean> {
		const node = deps.node;
		const selectedWidget = deps.widgetSelection.getSelected();
		if (selectedWidget === null) return false;

		const widget = findWidgetNodeByStart(selectedWidget.sourceStart, inlinesOf(node), node.raw);
		const widgetIsHere =
			widget !== null && deps.widgetSelection.isSelected(deps.myPath, selectedWidget.sourceStart);
		if (!widgetIsHere) return false;

		// The widget kind's editing policy claims custom keys first — image resize
		// (Shift+Arrow) lives there. Flattened so the nested image of
		// `[![alt][ref]][repo]` is the resolved widget.
		const inline = flattenInlineWidgets(inlinesOf(node), node.raw).find(
			(n) => n.start === widget.start
		);
		if (inline) {
			const policy = getInlineWidgetEditing(inline.kind);
			const consumed = policy?.onSelectedKey?.(e, {
				node,
				inline,
				widgetStart: widget.start,
				widgetEnd: widget.end,
				index: deps.index,
				preSelectOffset: selectedWidget.preSelectOffset,
				editorContentWidth: deps.getEditorContentWidth(),
				updateContent: (newRaw, caretBefore, caretAfter) =>
					deps.blockEdit.updateBlockContent(deps.index, newRaw, caretBefore, caretAfter)
			});
			if (consumed) return true;
		}
		// A kind that claims no Shift+Arrow key still swallows it — stepping out is
		// reserved for plain Arrow (the branches below).
		if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
			e.preventDefault();
			return true;
		}
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			if (rawHasNoTextBefore(node.raw, widget.start)) {
				deps.widgetSelection.clear();
				await deps.focusActions.moveFocus(deps.index - 1, 'end');
			} else {
				deps.cursor.setRaw(asRawOffset(widget.start));
				deps.widgetSelection.clear();
			}
			return true;
		}
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			if (rawHasNoTextAfter(node.raw, widget.end)) {
				deps.widgetSelection.clear();
				await deps.focusActions.moveFocus(deps.index + 1, 'start');
			} else {
				deps.cursor.setRaw(asRawOffset(widget.end));
				deps.widgetSelection.clear();
			}
			return true;
		}
		if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			const newRaw = node.raw.slice(0, widget.start) + node.raw.slice(widget.end);
			// Undo anchor at the pre-select caret position, not the far widget
			// boundary — Ctrl+Z restores the caret where the user actually was
			// when selection took over.
			deps.blockEdit.updateBlockContent(
				deps.index,
				newRaw,
				selectedWidget.preSelectOffset,
				widget.start
			);
			deps.widgetSelection.clear();
			return true;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			deps.cursor.setRaw(asRawOffset(widget.end));
			deps.widgetSelection.clear();
			return true;
		}
		if (isTypingKey(e)) {
			e.preventDefault();
			const typed = e.key;
			const newRaw = node.raw.slice(0, widget.start) + typed + node.raw.slice(widget.end);
			deps.blockEdit.updateBlockContent(
				deps.index,
				newRaw,
				selectedWidget.preSelectOffset,
				widget.start + typed.length
			);
			deps.widgetSelection.clear();
			return true;
		}
		// Selected-and-here swallows every remaining key, so navigation can't
		// leak into the shared pipeline mid-selection.
		return true;
	}

	function handleShiftArrowIntoWidget(e: KeyboardEvent): boolean {
		// While source is revealed the widget's raw is unchanged, so the CST still
		// reports it as an atomic island — but the DOM is editable text. Let native
		// selection run over the source instead of stepping past a phantom widget.
		if (activeReveal) return false;
		const el = deps.getEl();
		if (!el) return false;
		if (!e.shiftKey || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return false;
		const widgetExt = widgetExtensionTarget(e.key);
		if (widgetExt === null) return false;
		e.preventDefault();
		extendSelectionToRaw(widgetExt);
		return true;
	}

	// The reveal-vs-select entry dispatch, shared by within-block caret entry and
	// cross-block edge landing — the ONE seam the policy split lives at (the click
	// path keys off the same `revealSource` predicate). A reveal-capable kind opens
	// its source reveal at the entered edge (Obsidian model — the caret never parks
	// in an invisible widget-selected state); anything else selects (image overlay).
	// `fromTrailingEdge` is the direction the caret entered from: it fixes both the
	// reveal caret target (trailing edge = source length, leading = 0) and the undo /
	// pre-select anchor (the widget's trailing vs leading offset).
	function enterWidget(
		widget: { start: number; end: number; kind: AnyInlineKind },
		fromTrailingEdge: boolean
	): void {
		const enteredOffset = fromTrailingEdge ? widget.end : widget.start;
		if (getInlineWidgetEditing(widget.kind)?.revealSource) {
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

	function handleWidgetAtCursorKeydown(
		e: KeyboardEvent,
		effectiveOffset: RawOffset | null
	): boolean {
		if (activeReveal) return false;
		if (effectiveOffset === null) return false;
		const node = deps.node;
		const widgetAt = widgetAtCursor(effectiveOffset, inlinesOf(node), node.raw);
		if (!widgetAt) return false;

		// Caret-entry against a widget edge: ArrowLeft/Backspace from the trailing
		// edge, ArrowRight/Delete from the leading edge.
		const enterFromRight =
			!e.shiftKey && widgetAt.atRight && (e.key === 'ArrowLeft' || e.key === 'Backspace');
		const enterFromLeft =
			!e.shiftKey && !widgetAt.atRight && (e.key === 'ArrowRight' || e.key === 'Delete');
		if (enterFromRight || enterFromLeft) {
			e.preventDefault();
			deps.setSnapTarget(null);
			enterWidget(widgetAt, enterFromRight);
			return true;
		}
		// Chromium inserts into a text node natively, but drops printable keys at
		// element-level positions adjacent to a contenteditable=false widget.
		if (!caretIsInTextNode() && isTypingKey(e)) {
			e.preventDefault();
			deps.setSnapTarget(null);
			const typed = e.key;
			const newRaw = node.raw.slice(0, effectiveOffset) + typed + node.raw.slice(effectiveOffset);
			const postEdit = effectiveOffset + typed.length;
			deps.blockEdit.updateBlockContent(deps.index, newRaw, effectiveOffset, postEdit);
			// Re-anchor the caret after the rerender — without it, the next
			// keystroke teleports to div offset 0.
			deps.setPendingCursor(postEdit);
			return true;
		}
		return false;
	}

	function enterEdgeWidget(side: 'start' | 'end'): boolean {
		const inlines = inlinesOf(deps.node);
		if (inlines.length === 0) return false;
		const target =
			side === 'start'
				? findFirstEdgeWidget(inlines, deps.node.raw)
				: findLastEdgeWidget(inlines, deps.node.raw);
		if (!target) return false;
		// Focus the contenteditable so subsequent keys route to this block's handler.
		deps.getEl()?.focus();
		// A 'start' landing arrives at the widget's leading edge, 'end' at the trailing.
		enterWidget(target, side === 'end');
		return true;
	}

	function snapClickToWidgetEdge(clickX: number | null, clickY: number | null): void {
		deps.setSnapTarget(null);
		const el = deps.getEl();
		if (!el || clickX === null) return;
		// A click that lands ON a reveal-source widget enters source editing. The
		// point-in-rect test is authoritative and runs before the text-node guard
		// below: reveal fires only when the pointer is inside the widget's box, so a
		// column-aligned click on real text on another visual line falls through to
		// the caret path instead of revealing.
		if (clickY !== null && hitTestRevealWidget(el, clickX, clickY)) {
			void revealFromClick(clickX, clickY);
			return;
		}
		// Don't override a click that landed in a real text node — native caret
		// renders there and a synthetic overlay would compete.
		if (caretIsInTextContent(el, window.getSelection())) return;
		for (const inline of inlinesOf(deps.node)) {
			if (!isInlineWidget(inline, deps.node.raw)) continue;
			const widget = el.querySelector(
				`[data-inline-widget][data-source-start="${inline.start}"]`
			) as HTMLElement | null;
			if (!widget) continue;
			const rect = widget.getBoundingClientRect();
			if (clickX > rect.right) {
				el.focus();
				deps.cursor.setRaw(asRawOffset(inline.end));
				// `setRaw`'s walker may have landed the caret in a trailing text
				// node — in that case native renders, no synthetic needed.
				if (!caretIsInTextContent(el, window.getSelection())) {
					deps.setSnapTarget(inline.end);
				}
				return;
			}
			if (clickX < rect.left) {
				el.focus();
				deps.cursor.setRaw(asRawOffset(inline.start));
				if (!caretIsInTextContent(el, window.getSelection())) {
					deps.setSnapTarget(inline.start);
				}
				return;
			}
		}
	}

	function widgetExtensionTarget(key: 'ArrowRight' | 'ArrowLeft'): number | null {
		const el = deps.getEl();
		if (!el) return null;
		const sel = window.getSelection();
		if (!sel || sel.focusNode === null || !el.contains(sel.focusNode)) return null;
		const content = domTextOffsetAtNode(el, sel.focusNode, sel.focusOffset);
		const focus = toClampedRawOffset(content, deps.getAmbientLength());
		for (const inline of inlinesOf(deps.node)) {
			if (!isInlineWidget(inline, deps.node.raw)) continue;
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

	function caretIsInTextNode(): boolean {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return false;
		return sel.getRangeAt(0).startContainer.nodeType === Node.TEXT_NODE;
	}

	return {
		isVerticallyTransparent,
		handleSelectedWidgetKeydown,
		handleShiftArrowIntoWidget,
		handleWidgetAtCursorKeydown,
		enterEdgeWidget,
		snapClickToWidgetEdge,
		isRevealing,
		handleRevealingKeydown,
		commitRevealOnBlur,
		foldRevealIfSelectionEscaped,
		isPointOnRevealWidget
	};
}
