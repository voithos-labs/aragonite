/**
 * The single caret-edge dispatch. One plain (no ctrl/meta/alt) Backspace/Delete or
 * printable key at a caret edge in a prose block routes here, is classified into a
 * construct class, and is resolved against that class's declarative edge policy —
 * never native contenteditable mutation, which would silently corrupt the atomic
 * bytes each construct stands for. Replaces three former sibling seams (a CST
 * inline-widget handler, a decoration-island handler, and the ambient-marker
 * selection branch) so a fourth caret-edge interception can't be born unfunnelled.
 *
 * Classes are tried in the order TextEditableBlock's onKeyDown ran them, which is
 * observable when a caret sits against two at once (widget wins over island):
 *
 *   class            policy vocabulary                         behavior
 *   ───────────────  ────────────────────────────────────────  ─────────────────────────────
 *   reveal widget    revealSource: true                        reveal source on entry (math, directive text)
 *   image widget     select-then-delete (the widget default)   select whole; second press deletes (selected-widget seam)
 *   entity widget    deleteGranularity:'atomic' + step-over    delete whole in one press; a plain arrow walks over it
 *   replace island   onEdge:'select' + 'select-then-delete'    select whole; second press deletes the hidden range
 *   widget island    onEdge:'step-over'                        transparent — act on the adjacent real byte
 *   ambient overlap  guarded range                             delete the selection overlapping the non-editable marker
 *
 * A non-reveal widget with no explicit policy takes the image row's default. An
 * explicit deleteGranularity:'atomic' diverges (whole-delete on one press); an
 * explicit onEdge:'step-over' declines a plain arrow so native steps the caret
 * across the atomic island. A SURFACE may substitute the policy for a widget it
 * paints on other terms (`widgetEdgePolicy`) — the rows above assume prose
 * affordances, and a select-then-delete with no selection to paint is a press that
 * looks like nothing happened. Islands carry internal policy records
 * in the same vocabulary (never on the public API); the ambient marker is the
 * deliberate exception — a one-press delete of the selection range overlapping the
 * marker, not a caret-edge construct, so it fits no onEdge/deleteGranularity value.
 *
 * Entry execution (reveal vs select) stays at the `enterWidget` seam in
 * widget-interaction.ts — this consults the policy and calls it. The
 * selected-widget second press (deleting an already-selected widget) is a distinct
 * selected-state seam that still lives in widget-interaction.ts; it runs before the
 * shared keymap because selection clears the native range, and cannot move here
 * without reordering behind it.
 */

import type { BlockEditActions } from '../../../action-contracts';
import type { NodeView } from '../../../core/node-views';
import type { LinkReferenceResolverRef } from '../../../editor-keys';
import type { InlineNode } from '../../../core/nodes';
import type { InlineWidgetEditingPolicy } from '../../../core/inline/inline-widgets';
import { resolvedInlineContent } from '../../../core/inline/inline-cache';
import { getInlineWidgetEditing } from '../../../core/inline/inline-widgets';
import { trimTrailingLineEnding, trailingLineEnding } from '../../../core/lines';
import { type RawOffset } from '../../../cursor/coordinate-spaces';
import { hasSelection as hasSelectionHelper } from '../../../cursor/content-offsets';
import { ambientSpanOf } from '../../../ambient/ambient-dom';
import { recordIslandKeyScan } from '../../../perf/instruments';
import { caretIsInTextContent, hasModifier, isPlainTypingKey } from './click-snap-guard';
import { widgetAtCursor } from './widget-adjacency';

/** The subset of the inline-widget vocabulary the internal island/ambient policies
 *  reuse — expressing them in the same terms without leaking into the public API. */
export type EdgePolicy = Pick<InlineWidgetEditingPolicy, 'onEdge' | 'deleteGranularity'>;

const REPLACE_ISLAND_POLICY: EdgePolicy = {
	onEdge: 'select',
	deleteGranularity: 'select-then-delete'
};
const WIDGET_ISLAND_POLICY: EdgePolicy = { onEdge: 'step-over' };

interface IslandSpan {
	start: number;
	end: number;
	el: HTMLElement;
}

/** What the dispatch must reach: the live block, its inline resolution, the
 *  entry-seam hooks, and the selection/commit surface. Reactive state arrives as
 *  getters so a captured value can't go stale under re-render. */
export interface EdgePolicyDispatchDeps {
	get node(): NodeView;
	get index(): number;
	get linkRef(): LinkReferenceResolverRef | undefined;
	getEl: () => HTMLElement | null;
	getAmbientLength: () => number;
	/** Whether this block currently carries any decoration islands. The render path's
	 *  own source for the same set (`decorationEngine.islandsForPath`), so a false read
	 *  gates the per-keystroke DOM scan without risking disagreement with the painted
	 *  `[data-decoration-island]` spans. */
	hasIslands: () => boolean;
	/** Anchor/focus raw-content offsets of the live selection, or null when collapsed. */
	getRawSelection: () => { start: RawOffset; end: RawOffset } | null;
	blockEdit: BlockEditActions;
	/** Park a caret for the post-render restore, tagged with the gesture for the
	 *  trace. `writtenText` is the text that offset addresses: a kind whose write
	 *  sink rewrites bytes (tableCell escapes every free `|`) moves the offset, and
	 *  only the text it was measured against can map it. Omitted where the arm parks
	 *  ahead of every byte the write can change, so no mapping exists to get wrong. */
	setPendingCursor: (offset: number | null, source: string, writtenText?: string) => void;
	setSnapTarget: (offset: number | null) => void;
	/** A widget's `$…$` source is currently revealed — the CST still reports the
	 *  widget as atomic, but the DOM is editable text, so the widget branch stands
	 *  down and lets native editing (and island/ambient) run. */
	isRevealing: () => boolean;
	/** The reveal-vs-select entry seam; the dispatch owns classification, this owns
	 *  the entry execution and the reveal state machine. */
	enterWidget: (
		widget: { start: number; end: number; kind: InlineNode['kind'] },
		fromTrailingEdge: boolean
	) => void;
	/**
	 * Substitute the edge policy for a caret-adjacent widget this surface renders on
	 * terms the kind's registration does not assume. A policy names an affordance —
	 * `select-then-delete` promises a visible selected state — and a surface that
	 * paints none has to answer differently rather than degrade: a table cell reads
	 * `deleteGranularity: 'atomic'` for the widgets it paints, so a destructive key
	 * takes the whole construct in one press instead of a two-press dance with nothing
	 * on screen between the presses. Returning `undefined` (or omitting the dep) keeps
	 * the kind's registered policy, so the fallthrough is the common case.
	 */
	widgetEdgePolicy?: (widget: {
		start: number;
		end: number;
		kind: InlineNode['kind'];
	}) => EdgePolicy | undefined;
	/** Reading mode: island and ambient handling stand down wholesale, and the
	 *  widget branch commits nothing (a selected-widget still selects). */
	isReading: () => boolean;
}

export interface EdgePolicyDispatch {
	/** A plain edge key against a caret-adjacent construct. Returns whether the event
	 *  was consumed; a false return leaves the key to the shared keymap below. */
	handleKeydown(e: KeyboardEvent, caretOffset: RawOffset | null): boolean;
}

export function createEdgePolicyDispatch(deps: EdgePolicyDispatchDeps): EdgePolicyDispatch {
	function inlinesOf(node: NodeView): InlineNode[] {
		return resolvedInlineContent(node, deps.linkRef);
	}

	function display(): string {
		return trimTrailingLineEnding(deps.node.raw);
	}

	// ── CST inline widget ────────────────────────────────────────────────────

	function handleCstWidget(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		if (deps.isRevealing()) return false;
		if (caretOffset === null) return false;
		const node = deps.node;
		// Forward keys enter the widget after the caret, backward keys the one before —
		// so a caret between two adjacent widgets enters the correct one instead of
		// letting native contenteditable delete the far island whole.
		const direction = e.key === 'ArrowRight' || e.key === 'Delete' ? 'forward' : 'backward';
		const widgetAt = widgetAtCursor(caretOffset, inlinesOf(node), node.raw, direction);
		if (!widgetAt) return false;

		// Caret-entry against a widget edge: ArrowLeft/Backspace from the trailing
		// edge, ArrowRight/Delete from the leading edge — and only unchorded. A
		// modifier makes the key a word-scoped platform command; entering here would
		// swap a word-step for the modal widget-selected state, where the user's next
		// printable key replaces the construct's bytes instead of typing beside them.
		const plainEdgeKey = !e.shiftKey && !hasModifier(e);
		const enterFromRight =
			plainEdgeKey && widgetAt.atRight && (e.key === 'ArrowLeft' || e.key === 'Backspace');
		const enterFromLeft =
			plainEdgeKey && !widgetAt.atRight && (e.key === 'ArrowRight' || e.key === 'Delete');
		if (enterFromRight || enterFromLeft) {
			const isDestructive = e.key === 'Backspace' || e.key === 'Delete';
			const policy = deps.widgetEdgePolicy?.(widgetAt) ?? getInlineWidgetEditing(widgetAt.kind);
			// onEdge:'step-over' (inline entity): a plain arrow treats the widget as one
			// character — decline so native contenteditable carries the caret across the
			// atomic island. Only navigation steps over; a destructive key still runs the
			// atomic-delete branch below.
			if (!isDestructive && policy?.onEdge === 'step-over') return false;
			e.preventDefault();
			deps.setSnapTarget(null);
			if (isDestructive && policy?.deleteGranularity === 'atomic' && !deps.isReading()) {
				// An atomic kind (inline entity) deletes whole on one press — no select
				// step. Anchored at the pre-delete caret so Ctrl+Z lands there.
				const newRaw = node.raw.slice(0, widgetAt.start) + node.raw.slice(widgetAt.end);
				void deps.blockEdit.updateBlockContent(deps.index, newRaw, caretOffset, widgetAt.start);
				deps.setPendingCursor(widgetAt.start, 'widget');
				return true;
			}
			// onEdge:'select' (and reveal-capable kinds, which enterWidget routes to
			// their source reveal instead); step-over kinds already returned above.
			deps.enterWidget(widgetAt, enterFromRight);
			return true;
		}
		// Chromium inserts into a text node natively, but drops printable keys at
		// element-level positions adjacent to a contenteditable=false widget.
		const el = deps.getEl();
		if (
			el &&
			!caretIsInTextContent(el, window.getSelection()) &&
			isPlainTypingKey(e) &&
			!deps.isReading()
		) {
			e.preventDefault();
			deps.setSnapTarget(null);
			const typed = e.key;
			const newRaw = node.raw.slice(0, caretOffset) + typed + node.raw.slice(caretOffset);
			const postEdit = caretOffset + typed.length;
			void deps.blockEdit.updateBlockContent(deps.index, newRaw, caretOffset, postEdit);
			deps.setPendingCursor(postEdit, 'widget', newRaw);
			return true;
		}
		return false;
	}

	// ── Decoration island ────────────────────────────────────────────────────

	function islandsInDom(el: HTMLElement): IslandSpan[] {
		recordIslandKeyScan();
		const out: IslandSpan[] = [];
		for (const node of el.querySelectorAll<HTMLElement>('[data-decoration-island]')) {
			const start = Number(node.dataset.sourceStart);
			const end = Number(node.dataset.sourceEnd);
			if (Number.isInteger(start) && Number.isInteger(end)) out.push({ start, end, el: node });
		}
		return out;
	}

	function islandPolicy(island: IslandSpan): EdgePolicy {
		return island.end > island.start ? REPLACE_ISLAND_POLICY : WIDGET_ISLAND_POLICY;
	}

	function editDisplay(start: number, end: number, insert: string): void {
		const d = display();
		const next = d.slice(0, start) + insert + d.slice(end);
		const caretAfter = start + insert.length;
		void deps.blockEdit.updateBlockContent(
			deps.index,
			next + trailingLineEnding(deps.node.raw),
			start,
			caretAfter
		);
		deps.setPendingCursor(caretAfter, 'island', next);
	}

	function selectIslandWhole(el: HTMLElement): void {
		const sel = window.getSelection();
		if (!sel) return;
		const range = document.createRange();
		range.selectNode(el);
		sel.removeAllRanges();
		sel.addRange(range);
	}

	function handleIsland(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		// Modifier chords (Ctrl/Alt/Cmd word-delete and shortcuts) stay native — the
		// island rules own only the plain edge presses.
		const isDestructive = !hasModifier(e) && (e.key === 'Backspace' || e.key === 'Delete');
		const isTyping = isPlainTypingKey(e);
		if (!isDestructive && !isTyping) return false;

		// Island-free blocks (the common case) skip the DOM scan entirely: the engine's
		// path buckets are the same source the render just painted from, so a false here
		// cannot disagree with the DOM's `[data-decoration-island]` spans.
		if (!deps.hasIslands()) return false;

		const el = deps.getEl();
		if (!el) return false;
		const islands = islandsInDom(el);
		if (islands.length === 0) return false;

		// Second press: the native selection already wraps a replace island
		// (onEdge:'select'). Delete its whole hidden range through the CST — one undo entry.
		if (isDestructive) {
			const selection = deps.getRawSelection();
			if (selection && selection.start < selection.end) {
				const selected = islands.find(
					(i) =>
						islandPolicy(i).onEdge === 'select' &&
						i.start === selection.start &&
						i.end === selection.end
				);
				if (selected) {
					e.preventDefault();
					editDisplay(selected.start, selected.end, '');
					return true;
				}
				// A different non-empty selection — leave it to the normal delete paths.
				return false;
			}
		}

		if (caretOffset === null) return false;
		const contentLength = display().length;

		// First press: a replace island's edge selects the whole island. Selecting a
		// hidden byte is the only visible thing to eat; deleting it whole follows next.
		if (isDestructive) {
			const wantTrailingEdge = e.key === 'Backspace';
			const target = islands.find(
				(i) =>
					islandPolicy(i).onEdge === 'select' &&
					(wantTrailingEdge ? i.end === caretOffset : i.start === caretOffset)
			);
			if (target) {
				e.preventDefault();
				selectIslandWhole(target.el);
				return true;
			}
		}

		// Widget island (onEdge:'step-over'): transparent to the adjacent real byte. At
		// a true block boundary there is none — fall through so block merge still fires.
		const widget = islands.find(
			(i) => islandPolicy(i).onEdge === 'step-over' && i.start === caretOffset
		);
		if (!widget) return false;
		if (e.key === 'Backspace' && caretOffset > 0) {
			e.preventDefault();
			editDisplay(caretOffset - 1, caretOffset, '');
			return true;
		}
		if (e.key === 'Delete' && caretOffset < contentLength) {
			e.preventDefault();
			editDisplay(caretOffset, caretOffset + 1, '');
			return true;
		}
		// Cross-browser defence: some engines drop printable keys at an element-level
		// caret adjacent to a contenteditable=false island. Chromium types natively
		// (masking this branch in e2e), so the branch is unit-pinned. A text-node caret
		// always types natively.
		if (isTyping && !caretIsInTextContent(el, window.getSelection())) {
			e.preventDefault();
			editDisplay(caretOffset, caretOffset, e.key);
			return true;
		}
		return false;
	}

	// ── Ambient marker overlap ─────────────────────────────────────────────────

	// A selection whose DOM range extends into the contenteditable="false" ambient
	// span blocks native Backspace/Delete silently — the browser refuses to modify
	// any range overlapping non-editable content, and no beforeinput fires. Perform
	// the delete via the CST path instead.
	function handleAmbient(e: KeyboardEvent): boolean {
		if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
		if (!hasSelectionHelper()) return false;
		const el = deps.getEl();
		if (!el || deps.getAmbientLength() <= 0) return false;
		const ambient = ambientSpanOf(el);
		const sel = window.getSelection();
		const touchesAmbient =
			!!ambient &&
			!!sel &&
			sel.rangeCount > 0 &&
			(ambient.contains(sel.anchorNode) || ambient.contains(sel.focusNode));
		if (!touchesAmbient) return false;
		e.preventDefault();
		const range = deps.getRawSelection();
		if (range && range.start < range.end) {
			const shown = display();
			const newDisplay = shown.slice(0, range.start) + shown.slice(range.end);
			void deps.blockEdit.updateBlockContent(
				deps.index,
				newDisplay + trailingLineEnding(deps.node.raw),
				range.start,
				range.start
			);
			deps.setPendingCursor(range.start, 'ambient-delete');
		}
		return true;
	}

	function handleKeydown(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		if (handleCstWidget(e, caretOffset)) return true;
		// Islands and the ambient marker are destructive-only view guards; reading mode
		// skips both wholesale (the widget branch above still selects, committing nothing).
		if (deps.isReading()) return false;
		if (handleIsland(e, caretOffset)) return true;
		if (handleAmbient(e)) return true;
		return false;
	}

	return { handleKeydown };
}
