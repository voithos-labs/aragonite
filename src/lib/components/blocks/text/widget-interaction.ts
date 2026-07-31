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
import type { RevealFold } from '../editable-surface';
import { caretIsInTextContent, hasModifier, isPlainTypingKey } from './click-snap-guard';
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
	/** Park a caret for the post-render restore. `writtenText` is the text that offset
	 *  addresses: a kind whose write sink rewrites bytes moves the offset, and only that
	 *  text can map it. */
	setPendingCursor: (offset: number | null, writtenText?: string) => void;
	/** The block's live DOM as raw text, read on reveal commit to pick up the ephemeral
	 *  source edit that never went through the CST. */
	readRawText: () => string;
	/** Mirrors reveal-active into the component, so `onInput` and IME compositionend
	 *  suppress the per-keystroke CST commit while source is shown. */
	setRevealing: (value: boolean) => void;
	/** Folding a revealed source mid-selection would strand an endpoint anchored in it. */
	isCrossBlock: () => boolean;
	/** Effective mode; reading gates reveal-open and the widget edit arms. Optional so
	 *  bare harnesses read as 'source'. */
	getPresentationMode?: () => PresentationMode;
	get linkRef(): LinkReferenceResolverRef | undefined;
}

export interface WidgetInteraction {
	/** Block holds only image/blank inline content, so vertical arrow traversal skips
	 *  it: the widgets carry no column meaning. */
	isVerticallyTransparent(): boolean;
	/** Keydown while a widget is selected. Every key is consumed in that state, so a
	 *  true return must not fall through to the shared pipeline. */
	handleSelectedWidgetKeydown(e: KeyboardEvent): Promise<boolean>;
	/** Shift+Arrow into a widget; extends the native selection to the far boundary. */
	handleShiftArrowIntoWidget(e: KeyboardEvent): boolean;
	/** Enter a widget at a caret edge — the reveal-vs-select policy split. The caret-edge
	 *  dispatch classifies the edge and calls this. */
	enterWidget(
		widget: { start: number; end: number; kind: AnyInlineKind },
		fromTrailingEdge: boolean
	): void;
	/** Cross-block edge landing: a reveal-capable widget at the near edge opens its
	 *  source, any other is selected. Returns whether an edge widget was entered. */
	enterEdgeWidget(side: 'start' | 'end'): boolean;
	/** Snap a click that landed outside any text node to the nearest widget edge. */
	snapClickToWidgetEdge(clickX: number | null, clickY: number | null): void;
	/** A reveal-source widget currently shows its editable `$…$` source. */
	isRevealing(): boolean;
	/** Escape (cancel to rendered) while source is shown. Enter is deliberately NOT
	 *  claimed: it is the block's split command, and the command seam folds first. */
	handleRevealingKeydown(e: KeyboardEvent): Promise<boolean>;
	/** Commit the revealed source when focus leaves the block. */
	commitRevealOnBlur(): void;
	/** Fold an active reveal before ANY mutation of the block, so the mutation runs
	 *  against a CST matching the swapped DOM. Null if none was open; otherwise the
	 *  committed caret and a write completion the caller MUST await before mutating. */
	foldRevealBeforeMutation(caretAfter?: number): RevealFold | null;
	/** Fold when the caret escapes a revealed source but stays inside the block; blur
	 *  owns the focus-leaving fold. */
	foldRevealIfSelectionEscaped(): void;
	/** The point sits on a reveal-source widget — pointerdown preventDefaults the
	 *  browser's caret task so nothing races the reveal's own placement. */
	isPointOnRevealWidget(x: number, y: number): boolean;
}

export function createWidgetInteraction(deps: WidgetInteractionDeps): WidgetInteraction {
	const isReading = () => deps.getPresentationMode?.() === 'reading';

	// Resolver-aware so widget detection matches the render path's view; a mismatch
	// around reference-style image widgets breaks cursor and clipboard offsets.
	function inlinesOf(node: NodeView): InlineNode[] {
		return resolvedInlineContent(node, deps.linkRef);
	}

	// ── Reveal-source editing ──────────────────────────────────────────────────
	// A reveal-source widget swaps its rendered island for editable source. The edit is
	// ephemeral DOM (`onInput` stays suppressed) and re-renders on commit rather than per
	// keystroke, so the whole edit lands as ONE undo entry. The lifecycle is one record —
	// null = idle — and every exit funnels its state-clear through `resetReveal`, so a new
	// exit only decides how the widget is restored, never which fields to hand-clear.
	interface RevealState {
		kernel: SourceReveal;
		/** Trailing-edge fallback for the commit caret when the source node is gone. */
		widgetEnd: number;
		/** Undo anchor: where the caret sat before entry. */
		caretBefore: number;
		/** Pre-edit display text; a commit with no diff folds without touching the CST. */
		originalDisplay: string;
		/** Entry window between showSource and the kernel's caret landing: a selectionchange
		 *  delivered inside it reads a pre-reveal selection, not an escape. */
		settling: boolean;
	}
	let revealState: RevealState | null = null;

	// Outside the record because they must survive `resetReveal` for the kernel's async
	// restore. Identity is load-bearing: two byte-identical widgets share a reuse-pool key,
	// so a lookup can return the OTHER instance and `replaceWith` would MOVE it.
	let activeSourceNode: Text | null = null;
	let revealedWidget: HTMLElement | null = null;

	// Every fold entry is module-private and pre-guarded by all of its callers, so a fold
	// with no active reveal means a new caller skipped the guard or a flag leaked (G1.26).
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

	// The one canonical teardown. Widget restoration is a SEPARATE step, so the swap
	// handles are left untouched: cancel resets the record before awaiting the kernel
	// restore that still needs them.
	function resetReveal(): void {
		revealState = null;
		deps.setRevealing(false);
	}

	async function startReveal(
		widget: { start: number; end: number },
		caretBefore: number,
		atSourceOffset = 0
	): Promise<void> {
		// Every reveal entry converges here, so this is the one reading-mode gate needed.
		if (isReading()) return;
		// The settle window spans only microtasks plus the synchronous focus dispatch, so
		// no user gesture lands inside it — a re-entry is a call from the chain itself (G1.26).
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
		// The imperative span-swap IS the mechanism: the opaque island becomes a text node.
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
			// `finally`, not a plain clear: a wedged-true flag would disable the escape fold
			// for the rest of the block's life. Guarded — a fold mid-await already nulled it.
			if (revealState) revealState.settling = false;
		}
	}

	// Persist the ephemeral source edit, or fold back untouched. The caret lands on the
	// source node's LIVE trailing edge, so a concurrent prose edit shifts it correctly.
	// ALWAYS folds: a null read as "nothing to wait for" would let a seam splice stale bytes.
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
		// The reactive re-render rebuilds the island, so drop the swap handles without a
		// DOM restore, then run the canonical teardown.
		activeSourceNode = null;
		revealedWidget = null;
		resetReveal();
		// No edit: fold without touching the CST. A zero-diff write still pushes a dead
		// undo entry, so the user's next Ctrl+Z would revert nothing instead of their
		// prior action. The pending-cursor set alone re-renders from the untouched CST.
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

	// "Settled" for every fold caller: the write landed AND the render it forced flushed.
	// A rejection is absorbed — the commit ceremony rethrows only in DEV, so forwarding
	// would let a DEV-only throw cancel the gesture the seam is holding open.
	async function settleWrite(write: void | Promise<void>): Promise<void> {
		try {
			await write;
		} catch {
			// reported at the commit seam
		}
		await tick();
	}

	// Discard the ephemeral edit and rebuild the original widget from the untouched raw:
	// a CST-free view toggle, so no undo entry.
	async function cancelReveal(): Promise<void> {
		assertFoldTargetsActiveReveal('cancelReveal');
		if (!revealState) return;
		const active = revealState;
		traceRevealFold('cancel');
		const { kernel } = active;
		// Reset BEFORE the await so the record reads idle across the kernel's restore:
		// `replaceWith` fires selectionchange, and a live record would let the escape-fold
		// re-enter mid-swap. The restore reads the swap handles kept outside the record.
		resetReveal();
		await kernel.commit();
	}

	// Click-away fold for an UNEDITED reveal: no caret is written, because the escaping
	// click owns the caret and the commit path's trailing-edge landing would hijack it.
	function foldRevealNoEdit(reason: RevealFoldReason = 'no-edit'): void {
		assertFoldTargetsActiveReveal('foldRevealNoEdit');
		if (!revealState) return;
		traceRevealFold(reason);
		resetReveal();
		restoreRenderedWidget();
	}

	// Containment is decided by RAW OFFSET through the canonical walk, boundary-inclusive:
	// a caret at the source's edge may anchor in the ADJACENT text node, the browser's
	// choice, and node identity would misread that as an escape.
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

	// An escape must SURVIVE A TICK to fold: cross-block entry clears the native selection
	// before its flag flips, manufacturing a transient escape-shaped state that re-verifying
	// rejects. The latch survives the very exit it triggers, so `resetReveal` never clears it.
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

	// The ONE hit test the pointerdown probe, the click dispatch, and the post-fold
	// re-resolve share.
	function hitTestRevealWidget(
		el: HTMLElement,
		x: number,
		y: number
	): { inline: InlineNode } | null {
		for (const inline of inlinesOf(deps.node)) {
			if (!isInlineWidget(inline, deps.node.raw)) continue;
			if (!getInlineWidgetEditing(inline.kind)?.revealSource) continue;
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

	// Order is the whole point: resolve the target BEFORE folding, because the fold shifts
	// layout and the click point only means something against pre-fold geometry, then
	// re-locate by OFFSET, because an edited commit shifts raw positions by its delta.
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
				await commitReveal()?.settled;
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

	// Escape is the only key the reveal claims. Enter deliberately isn't: it is the block's
	// split command everywhere else, and the command seam folds the reveal before it
	// mutates, so one Enter both commits the edit and splits.
	async function handleRevealingKeydown(e: KeyboardEvent): Promise<boolean> {
		if (!revealState) return false;
		if (e.key === 'Escape') {
			e.preventDefault();
			await cancelReveal();
			return true;
		}
		return false;
	}

	// The one fold that stands down mid-cross-block: a sweeping selection keeps the source
	// revealed so its rects measure real text and no endpoint anchored in it is stranded
	// (the escape fold carries the same rule in `selectionEscapedSource`).
	function commitRevealOnBlur(): void {
		if (revealState && !deps.isCrossBlock()) commitReveal('blur');
	}

	// A mutation runs the CST pipeline against `node.raw`, which a live reveal has outrun,
	// so it must fold first. Returns the committed caret — a folded caret on an
	// element-level edge would land the paste at offset 0 — and the write's completion.
	function foldRevealBeforeMutation(caretAfter?: number): RevealFold | null {
		if (!revealState) return null;
		return commitReveal('commit', caretAfter);
	}

	function isVerticallyTransparent(): boolean {
		// Resolver-free, matching the off-window keyboard-extend path, so the vertical-skip
		// decision is uniform everywhere. Other widget reads stay resolver-aware.
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

		// The kind's editing policy claims custom keys first. Flattened so the nested image
		// of `[![alt][ref]][repo]` is the resolved widget.
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
		// Declining hands the chord to the keymap dispatch, which sits AFTER this handler and
		// owns undo/redo. Arrows are the exception: selecting cleared the native range, so a
		// shared-pipeline arm would read offset 0 and move focus to a block that isn't there.
		if (hasModifier(e)) {
			if (!e.key.startsWith('Arrow')) return false;
			e.preventDefault();
			return true;
		}
		// Swallowed even by a kind that claims no Shift+Arrow: stepping out is reserved
		// for plain Arrow.
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
			// Reading mode still swallows — a selected widget owns its keys — but commits nothing.
			if (isReading()) return true;
			const newRaw = node.raw.slice(0, widget.start) + node.raw.slice(widget.end);
			// Undo anchored at the pre-select caret, so Ctrl+Z restores the caret where the
			// user actually was when selection took over.
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
		if (isPlainTypingKey(e)) {
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
		// Every remaining key is swallowed, so navigation can't leak into the shared pipeline
		// mid-selection. preventDefault too: reporting the key consumed stops only THIS
		// editor's chain, and the browser's default would still mutate behind the CST.
		e.preventDefault();
		return true;
	}

	function handleShiftArrowIntoWidget(e: KeyboardEvent): boolean {
		// While source is revealed the CST still reports an atomic island, but the DOM is
		// editable text: let native selection run over it, not past a phantom widget.
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

	// The ONE seam the reveal-vs-select policy split lives at, shared by within-block caret
	// entry and cross-block edge landing. `fromTrailingEdge` fixes both the reveal caret
	// target and the undo / pre-select anchor.
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
		enterWidget(target, side === 'end');
		return true;
	}

	function snapClickToWidgetEdge(clickX: number | null, clickY: number | null): void {
		deps.setSnapTarget(null);
		const el = deps.getEl();
		if (!el || clickX === null) return;
		// The point-in-rect test runs BEFORE the text-node guard below, so a column-aligned
		// click on real text on another visual line falls through to the caret path.
		if (clickY !== null && hitTestRevealWidget(el, clickX, clickY)) {
			void revealFromClick(clickX, clickY);
			return;
		}
		// A click in a real text node keeps the native caret; a synthetic overlay would compete.
		if (caretIsInTextContent(el, window.getSelection())) return;
		for (const inline of inlinesOf(deps.node)) {
			if (!isInlineWidget(inline, deps.node.raw)) continue;
			const widget = widgetElByStart(el, inline.start);
			if (!widget) continue;
			const rect = widget.getBoundingClientRect();
			if (clickX > rect.right) {
				el.focus();
				deps.cursor.setRaw(asRawOffset(inline.end));
				// `setRaw`'s walker may have landed in a trailing text node, where native renders.
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
		foldRevealBeforeMutation,
		foldRevealIfSelectionEscaped,
		isPointOnRevealWidget
	};
}
