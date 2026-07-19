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
import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import type { NodeView } from '../../../core/node-views';
import type { PresentationMode } from '../../../presentation-mode';
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
import { trimTrailingLineEnding, trailingLineEnding } from '../../../core/lines';
import {
	asRawOffset,
	toClampedRawOffset,
	toDomTextOffset
} from '../../../cursor/coordinate-spaces';
import { domTextOffsetAtNode, createRangeAtDomTextOffsets } from '../../../cursor/widget-offset';
import { createSourceReveal, type SourceReveal } from '../../../cursor/reveal-source';
import {
	traceRevealOpen,
	traceRevealFold,
	type RevealFoldReason
} from '../../../debug/interaction-trace';
import { assertInvariant } from '../../../invariants/assert';
import { caretIsInTextContent } from './click-snap-guard';
import {
	findWidgetNodeByStart,
	findFirstEdgeWidget,
	findLastEdgeWidget,
	rawHasNoTextBefore,
	rawHasNoTextAfter
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
	/** Effective mode; reading gates reveal-open and the widget edit arms.
	 *  Optional so bare harnesses read as 'source'. */
	getPresentationMode?: () => PresentationMode;
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
	/** Enter a widget at a caret edge — the reveal-vs-select policy split. The
	 *  caret-edge dispatch classifies the edge and calls this; `fromTrailingEdge`
	 *  is the direction of entry. */
	enterWidget(
		widget: { start: number; end: number; kind: AnyInlineKind },
		fromTrailingEdge: boolean
	): void;
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
	/** Fold an active reveal before a clipboard mutation so cut/paste run against a
	 *  consistent CST. Returns the committed caret offset, or null if none was open. */
	commitRevealBeforeClipboard(): number | null;
	/** While source is revealed, fold when the caret/selection escapes it but
	 *  stays inside the block (blur owns the focus-leaving fold). */
	foldRevealIfSelectionEscaped(): void;
	/** The point sits on a reveal-source widget — pointerdown uses this to
	 *  preventDefault the browser's caret task so nothing races the reveal's
	 *  own placement. */
	isPointOnRevealWidget(x: number, y: number): boolean;
}

export function createWidgetInteraction(deps: WidgetInteractionDeps): WidgetInteraction {
	const isReading = () => deps.getPresentationMode?.() === 'reading';

	// Resolver-aware so widget detection matches the render path's view — a
	// mismatch around reference-style image widgets breaks cursor/clipboard.
	function inlinesOf(node: NodeView): InlineNode[] {
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
	//
	// The lifecycle is one record: null = idle, non-null = revealed (with a
	// transient `settling` window during entry). Every exit path funnels its
	// state-clear through the one canonical resetReveal(), so a new exit only
	// decides how the widget is restored — never which fields to hand-clear.
	interface RevealState {
		kernel: SourceReveal;
		/** Trailing-edge fallback for the commit caret when the source node is gone. */
		widgetEnd: number;
		/** Undo anchor: where the caret sat before entry. */
		caretBefore: number;
		/** Pre-edit display text; a commit with no diff folds without touching the CST. */
		originalDisplay: string;
		/** Entry window between showSource and the kernel's caret landing: a
		 *  selectionchange delivered inside it reads a pre-reveal selection and must
		 *  not be mistaken for an escape. */
		settling: boolean;
	}
	let revealState: RevealState | null = null;

	// The DOM-swap handles live OUTSIDE the record because their lifetime is longer:
	// on cancel they must survive past resetReveal so the kernel's async showRendered
	// can still restore the exact element the swap detached. Identity is load-bearing
	// — two byte-identical widgets share a reuse-pool key, so any rebuild-by-lookup
	// can return the OTHER live instance, and replaceWith would MOVE it, vacating its
	// slot and desyncing DOM from CST. Only the captured element is guaranteed to be
	// the one this reveal swapped out. `activeSourceNode` also reads the source's live
	// DOM position (its post-edit trailing edge) at commit and doubles as the kernel's
	// swapped-in flag.
	let activeSourceNode: Text | null = null;
	let revealedWidget: HTMLElement | null = null;

	// Every fold entry below is module-private and pre-guarded by all of its
	// callers, so a fold arriving with no active reveal means a new caller skipped
	// the guard (the sibling-path parity class) or the machine's flag leaked (G1.26).
	function assertFoldTargetsActiveReveal(entry: string): void {
		assertInvariant('reveal-transition', () =>
			revealState
				? null
				: { code: 'fold-without-reveal', message: `${entry} with no active reveal` }
		);
	}

	function restoreRenderedWidget(): void {
		if (activeSourceNode === null || revealedWidget === null) return;
		activeSourceNode.replaceWith(revealedWidget);
		activeSourceNode = null;
		revealedWidget = null;
	}

	// The one canonical teardown: drop the reveal record and lift the input-suppress
	// mirror. Widget restoration is a SEPARATE step (restoreRenderedWidget for the
	// in-place folds; a reactive re-render for commit), so the swap handles are left
	// untouched here — cancel resets the record before awaiting the kernel restore
	// that still needs them.
	function resetReveal(): void {
		revealState = null;
		deps.setRevealing(false);
	}

	async function startReveal(
		widget: { start: number; end: number },
		caretBefore: number,
		atSourceOffset = 0
	): Promise<void> {
		// Every reveal entry (caret edge, click, cross-block edge landing)
		// converges here, so this is the one reading-mode gate reveal needs.
		if (isReading()) return;
		// The settle window spans only microtasks plus the synchronous focus
		// dispatch, so no user gesture can land inside it — a re-entry here is a
		// synchronous call from within the settle chain itself (G1.26).
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
		// The imperative span-swap IS the inline mechanism: replace the opaque
		// [data-inline-widget] island with a text node and back.
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
			// finally, not a plain clear: a wedged-true flag would disable the escape
			// fold for the rest of the block's life. Guarded because a fold during the
			// await would have already nulled the record.
			if (revealState) revealState.settling = false;
		}
	}

	// Persist the ephemeral source edit, or fold back untouched. The reactive
	// re-render (forced by the pending-cursor set) is what re-renders the widget —
	// "commit re-renders" without the imperative swap — so the CST holds the edit
	// for serialize/undo. The caret lands on the math's new trailing edge, read from
	// the revealed source node's live position so an edit to the surrounding prose
	// shifts it correctly (a length delta off the widget's old end would not).
	function commitReveal(reason: RevealFoldReason = 'commit'): number | null {
		assertFoldTargetsActiveReveal('commitReveal');
		if (!revealState) return null;
		// Alias the record before any call: TS drops the null-narrowing of a
		// closure-reassigned `let` across an intervening call.
		const active = revealState;
		// Sibling of editable-leaf's `commitReveal`: a cross-block selection sweeping
		// through keeps the source revealed so its rects measure real text, not a
		// folded island — folding now would strand a selection endpoint anchored in
		// the source text node.
		if (deps.isCrossBlock()) return null;
		traceRevealFold(reason);
		const el = deps.getEl();
		const sourceNode = activeSourceNode;
		const editedDisplay = deps.readRawText();
		const caretAfter =
			el && sourceNode
				? toClampedRawOffset(
						domTextOffsetAtNode(el, sourceNode, sourceNode.length),
						deps.getAmbientLength()
					)
				: active.widgetEnd;
		const { caretBefore, originalDisplay } = active;
		// The reactive re-render rebuilds the island, so drop the swap handles without
		// a DOM restore, then run the canonical teardown.
		activeSourceNode = null;
		revealedWidget = null;
		resetReveal();
		// No edit: fold back to rendered without touching the CST. A zero-diff
		// updateBlockContent still pushes a dead undo entry (the debounced snapshot
		// fires before the noop reparse bails), so the user's next Ctrl+Z would
		// revert nothing instead of their prior action. setPendingCursor re-renders
		// from the untouched CST — folding the span-swap — and its caret restore is
		// focus-guarded, so a blur folds without yanking the caret back.
		if (editedDisplay === originalDisplay) {
			deps.setPendingCursor(caretAfter);
			return caretAfter;
		}
		void deps.blockEdit.updateBlockContent(
			deps.index,
			editedDisplay + trailingLineEnding(deps.node.raw),
			caretBefore,
			caretAfter
		);
		deps.setPendingCursor(caretAfter);
		return caretAfter;
	}

	// Cancel: discard the ephemeral edit, imperatively rebuilding the original
	// widget from the untouched raw (CST-free view toggle — no undo entry).
	async function cancelReveal(): Promise<void> {
		assertFoldTargetsActiveReveal('cancelReveal');
		if (!revealState) return;
		const active = revealState;
		traceRevealFold('cancel');
		const { kernel } = active;
		// Reset the record BEFORE the await so the record reads idle across the
		// kernel's restore: showRendered's replaceWith fires selectionchange, and a
		// live record would let the escape-fold re-enter mid-swap. The restore reads
		// the still-live swap handles (kept outside the record for exactly this).
		resetReveal();
		await kernel.commit();
	}

	// Click-away fold for an UNEDITED reveal: restore the widget synchronously and
	// write no caret — the escaping click owns the caret, and the kernel commit's
	// trailing-edge placement would hijack it.
	function foldRevealNoEdit(reason: RevealFoldReason = 'no-edit'): void {
		assertFoldTargetsActiveReveal('foldRevealNoEdit');
		if (!revealState) return;
		traceRevealFold(reason);
		resetReveal();
		restoreRenderedWidget();
	}

	// The selection currently reads as an escape: both endpoints in the block,
	// neither in the revealed source. Containment is decided by RAW OFFSET through
	// the canonical walk, boundary-inclusive: a caret at the source's edge may
	// anchor in the ADJACENT text node (the browser's choice), and node identity
	// would misread that as an escape.
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

	// Escape fold: while source is revealed, a caret/selection move that leaves the
	// source but stays inside the block folds the reveal (clean → widget restored
	// in place; edited → the commit path, one undo entry). Blur keeps owning the
	// focus-leaving fold; a cross-block sweep keeps the source revealed so its
	// rects measure real text. An escape must SURVIVE A TICK to fold: the editor's
	// own machinery (cross-block entry clearing the native selection for custom
	// rendering) manufactures transient escape-shaped states that a slow machine
	// delivers before the cross-block flag flips — re-verifying after tick makes
	// them unfoldable while a real user escape still folds.
	//
	// This latch is NOT reveal-lifecycle state: it coalesces the tick check and must
	// survive the very exit it triggers (its own finally clears it), so it lives
	// apart from the reveal record and resetReveal never touches it.
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
		return revealState !== null;
	}

	async function handleRevealingKeydown(e: KeyboardEvent): Promise<boolean> {
		if (!revealState) return false;
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
		if (revealState) commitReveal('blur');
	}

	// A clipboard mutation (cut/paste) runs the full CST pipeline against node.raw,
	// but a live reveal has the island swapped for edited DOM the CST hasn't seen —
	// splicing there corrupts. Fold first (as keydown/IME already gate the commit),
	// returning the committed caret so the caller can land the paste past the widget
	// instead of at offset 0 when the folded caret sits on an element-level edge.
	function commitRevealBeforeClipboard(): number | null {
		if (!revealState) return null;
		return commitReveal('commit');
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
				presentationMode: deps.getPresentationMode?.() ?? 'source',
				updateContent: (newRaw, caretBefore, caretAfter) =>
					void deps.blockEdit.updateBlockContent(deps.index, newRaw, caretBefore, caretAfter)
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
			// Reading mode: still swallow (a selected widget owns its keys) but
			// commit nothing.
			if (isReading()) return true;
			const newRaw = node.raw.slice(0, widget.start) + node.raw.slice(widget.end);
			// Undo anchor at the pre-select caret position, not the far widget
			// boundary — Ctrl+Z restores the caret where the user actually was
			// when selection took over.
			void deps.blockEdit.updateBlockContent(
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
			if (isReading()) return true;
			const typed = e.key;
			const newRaw = node.raw.slice(0, widget.start) + typed + node.raw.slice(widget.end);
			void deps.blockEdit.updateBlockContent(
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

	return {
		isVerticallyTransparent,
		handleSelectedWidgetKeydown,
		handleShiftArrowIntoWidget,
		enterWidget,
		enterEdgeWidget,
		snapClickToWidgetEdge,
		isRevealing,
		handleRevealingKeydown,
		commitRevealOnBlur,
		commitRevealBeforeClipboard,
		foldRevealIfSelectionEscaped,
		isPointOnRevealWidget
	};
}
