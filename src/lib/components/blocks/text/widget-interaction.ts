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
 * component can interleave them with the shared keydown pipeline at the same
 * points it always has.
 */

import type { BlockEditActions, FocusActions } from '../../../action-contracts';
import type { CstNode, InlineNode } from '../../../core/nodes';
import type { LinkReferenceResolverRef } from '../../../editor-keys';
import type { WidgetSelectionState } from '../../image/widget-selection-state.svelte';
import type { AmbientCursorIO } from '../../../ambient/ambient-cursor';
import { getInlineContent } from '../../../core/inline/inline-cache';
import {
	isInlineWidget,
	flattenInlineWidgets,
	getInlineWidgetEditing,
	buildCoreInlineWidget
} from '../../../core/inline/inline-widgets';
import { isVerticallyTransparentNode } from '../../../core/inline/transparency';
import { trimTrailingLineEnding } from '../../../core/lines';
import { rawOffsetAtNode, createRangeAtRawOffsets } from '../../../cursor/widget-offset';
import { createSourceReveal, type SourceReveal } from '../../../cursor/reveal-source';
import { caretIsInTextContent } from './click-snap-guard';
import {
	widgetAtCursor,
	findWidgetNodeByStart,
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
	handleWidgetAtCursorKeydown(e: KeyboardEvent, effectiveOffset: number | null): boolean;
	/** Snap a click that landed outside any text node to the nearest widget edge. */
	snapClickToWidgetEdge(clickX: number | null): void;
	/** A reveal-source widget currently shows its editable `$…$` source. */
	isRevealing(): boolean;
	/** Escape (cancel to rendered) / Enter (commit + re-render) while source is shown. */
	handleRevealingKeydown(e: KeyboardEvent): Promise<boolean>;
	/** Commit the revealed source when focus leaves the block. */
	commitRevealOnBlur(): void;
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
	let revealWidgetEnd = 0;
	let revealCaretBefore = 0;
	let revealOriginalDisplayLength = 0;

	async function startReveal(inline: InlineNode, caretBefore: number): Promise<void> {
		if (activeReveal) return;
		const start = inline.start;
		const end = inline.end;
		const source = deps.node.raw.slice(start, end);
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
			// Cancel rebuilds the ORIGINAL widget from the unchanged raw (the edit is
			// discarded); the persist path re-renders reactively instead, so this only
			// fires on Escape.
			renderWidget: () => buildRevealWidget(inline)
		});
		activeReveal = reveal;
		revealWidgetEnd = end;
		revealCaretBefore = caretBefore;
		revealOriginalDisplayLength = trimTrailingLineEnding(deps.node.raw).length;
		deps.widgetSelection.clear();
		deps.setRevealing(true);
		await reveal.reveal();
	}

	function buildRevealWidget(inline: InlineNode): HTMLElement {
		const widget = buildCoreInlineWidget(inline, deps.node.raw);
		if (!widget) {
			throw new Error(
				`reveal-source: kind "${inline.kind}" opts into revealSource but registers no core ` +
					`widget builder — buildCoreInlineWidget returned null.`
			);
		}
		return widget;
	}

	// Persist: read the ephemeral source edit back through the widget-aware walk and
	// commit it once. The reactive re-render (forced by the pending-cursor set) is
	// what re-renders the widget — "commit re-renders" without the imperative swap,
	// so the CST holds the edit for serialize/undo. Caret lands on the math's new
	// trailing edge; the edit is confined to the source region, so a plain length
	// delta locates it.
	function commitReveal(): void {
		if (!activeReveal) return;
		const editedDisplay = deps.readRawText();
		const delta = editedDisplay.length - revealOriginalDisplayLength;
		const caretAfter = revealWidgetEnd + delta;
		activeReveal = null;
		deps.setRevealing(false);
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
			// Enter on a reveal-source widget swaps the rendered island for its editable
			// `$…$` source (click-into is the other trigger — snapClickToWidgetEdge).
			if (policy?.revealSource && e.key === 'Enter') {
				e.preventDefault();
				await startReveal(inline, selectedWidget.preSelectOffset);
				return true;
			}
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
				deps.cursor.setRaw(widget.start);
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
				deps.cursor.setRaw(widget.end);
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
			deps.cursor.setRaw(widget.end);
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

	function handleWidgetAtCursorKeydown(e: KeyboardEvent, effectiveOffset: number | null): boolean {
		if (activeReveal) return false;
		if (effectiveOffset === null) return false;
		const node = deps.node;
		const widgetAt = widgetAtCursor(effectiveOffset, inlinesOf(node), node.raw);
		if (!widgetAt) return false;

		if (!e.shiftKey && widgetAt.atRight && (e.key === 'ArrowLeft' || e.key === 'Backspace')) {
			e.preventDefault();
			deps.setSnapTarget(null);
			deps.widgetSelection.select({
				paragraphPath: deps.myPath,
				sourceStart: widgetAt.start,
				preSelectOffset: widgetAt.end
			});
			return true;
		}
		if (!e.shiftKey && !widgetAt.atRight && (e.key === 'ArrowRight' || e.key === 'Delete')) {
			e.preventDefault();
			deps.setSnapTarget(null);
			deps.widgetSelection.select({
				paragraphPath: deps.myPath,
				sourceStart: widgetAt.start,
				preSelectOffset: widgetAt.start
			});
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

	function snapClickToWidgetEdge(clickX: number | null): void {
		deps.setSnapTarget(null);
		const el = deps.getEl();
		if (!el || clickX === null) return;
		// A click landing on a reveal-source widget enters source editing — checked
		// before the text-node guard below, since the click lands on the opaque
		// contenteditable=false island, not in editable text.
		for (const inline of inlinesOf(deps.node)) {
			if (!isInlineWidget(inline, deps.node.raw)) continue;
			if (!getInlineWidgetEditing(inline.kind)?.revealSource) continue;
			const widget = el.querySelector(
				`[data-inline-widget][data-source-start="${inline.start}"]`
			) as HTMLElement | null;
			if (!widget) continue;
			const rect = widget.getBoundingClientRect();
			if (clickX >= rect.left && clickX <= rect.right) {
				el.focus();
				void startReveal(inline, inline.start);
				return;
			}
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
				deps.cursor.setRaw(inline.end);
				// `setRaw`'s walker may have landed the caret in a trailing text
				// node — in that case native renders, no synthetic needed.
				if (!caretIsInTextContent(el, window.getSelection())) {
					deps.setSnapTarget(inline.end);
				}
				return;
			}
			if (clickX < rect.left) {
				el.focus();
				deps.cursor.setRaw(inline.start);
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
		const content = rawOffsetAtNode(el, sel.focusNode, sel.focusOffset);
		const focus = Math.max(0, content - deps.getAmbientLength());
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
		const target = deps.getAmbientLength() + rawOffset;
		const range = createRangeAtRawOffsets(el, target, target);
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
		snapClickToWidgetEdge,
		isRevealing,
		handleRevealingKeydown,
		commitRevealOnBlur
	};
}
