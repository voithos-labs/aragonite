/**
 * The single caret-edge dispatch (G4.12): one plain Backspace/Delete or printable key
 * at a caret edge in a prose block is classified into a construct class and resolved
 * against that class's declarative edge policy, never native contenteditable mutation,
 * which would silently corrupt the atomic bytes it stands for. Classes are tried CST
 * widget → decoration island → ambient marker, observable at a caret against two.
 */

import type { BlockEditActions } from '../../../action-contracts';
import type { NodeView } from '../../../core/node-views';
import type { LinkReferenceResolverRef } from '../../../editor-keys';
import type { InlineNode } from '../../../core/nodes';
import type { InlineWidgetEditingPolicy } from '../../../core/inline/inline-widgets';
import { resolvedInlineContent } from '../../../core/inline/inline-cache';
import { getContentRange } from '../../../core/inline';
import { getInlineWidgetEditing } from '../../../core/inline/inline-widgets';
import { trimTrailingLineEnding, trailingLineEnding } from '../../../core/lines';
import { type RawOffset } from '../../../cursor/coordinate-spaces';
import type { EdgeAffinity } from '../../../cursor/edge-affinity';
import type { PendingMarksState } from '../../../cursor/pending-marks';
import { hasSelection as hasSelectionHelper } from '../../../cursor/content-offsets';
import { landableRawBounds, revealsNoMarkers } from '../../../cursor/widget-offset';
import { ambientSpanOf } from '../../../ambient/ambient-dom';
import { recordIslandKeyScan } from '../../../perf/instruments';
import { caretIsInTextContent, hasModifier, isPlainTypingKey } from './click-snap-guard';
import { resolveEdgeDeletion } from './construct-edge-delete';
import { hidesStructuralSuffix } from './hidden-suffix';
import { resolveEdgeSeat } from './edge-seat';
import { resolveMarkedInsertion } from './pending-mark-insert';
import { widgetAtCursor } from './widget-adjacency';

/** The subset of the inline-widget vocabulary the internal island policies reuse,
 *  expressed in the same terms without leaking into the public API. */
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

/** Reactive state arrives as getters, so a captured value can't go stale under
 *  re-render. */
export interface EdgePolicyDispatchDeps {
	get node(): NodeView;
	get index(): number;
	get linkRef(): LinkReferenceResolverRef | undefined;
	getEl: () => HTMLElement | null;
	getAmbientLength: () => number;
	/** Whether this block carries any decoration islands. Reads the same source the render
	 *  painted from, so a false can't disagree with the DOM and safely skips the scan. */
	hasIslands: () => boolean;
	/** Anchor/focus raw-content offsets of the live selection, or null when collapsed. */
	getRawSelection: () => { start: RawOffset; end: RawOffset } | null;
	blockEdit: BlockEditActions;
	/** Park a caret for the post-render restore, tagged with the gesture for the trace.
	 *  `writtenText` is the text that offset addresses — a kind whose write sink rewrites
	 *  bytes moves it — and is omitted where the arm parks ahead of every changed byte. */
	setPendingCursor: (offset: number | null, source: string, writtenText?: string) => void;
	setSnapTarget: (offset: number | null) => void;
	/** A widget's source is revealed: the CST still reports it atomic, but the DOM is
	 *  editable text, so the widget branch stands down and lets native editing run. */
	isRevealing: () => boolean;
	/** The reveal-vs-select entry seam; the dispatch owns classification, this owns
	 *  the entry execution and the reveal state machine. */
	enterWidget: (
		widget: { start: number; end: number; kind: InlineNode['kind'] },
		fromTrailingEdge: boolean
	) => void;
	/**
	 * Substitute the edge policy for a widget this surface renders on terms the kind's
	 * registration doesn't assume: a policy names an affordance, and a surface that paints
	 * none must answer differently rather than degrade. `undefined` keeps the registration.
	 */
	widgetEdgePolicy?: (widget: {
		start: number;
		end: number;
		kind: InlineNode['kind'];
	}) => EdgePolicy | undefined;
	/** Reading mode: island and ambient handling stand down wholesale, and the
	 *  widget branch commits nothing (a selected-widget still selects). */
	isReading: () => boolean;
	/** The arrival side the typing seat consults; null when no arrival claimed one. */
	getEdgeAffinity: () => EdgeAffinity | null;
	/** The constructs a collapsed-caret toggle promised the next insertion. Read AND spent
	 *  here: the first byte after the chord is the one insertion they were pending for. */
	pendingMarks: PendingMarksState;
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

	/** One display-space rewrite, one CST commit. `caretBefore` anchors the undo entry, so it
	 *  is the pre-edit caret — the rewrite's own start everywhere but the seats, which moved it. */
	function writeDisplay(
		next: string,
		caretAfter: number,
		source: string,
		caretBefore: number
	): void {
		void deps.blockEdit.updateBlockContent(
			deps.index,
			next + trailingLineEnding(deps.node.raw),
			caretBefore,
			caretAfter
		);
		deps.setPendingCursor(caretAfter, source, next);
	}

	function editDisplay(
		start: number,
		end: number,
		insert: string,
		source = 'island',
		caretBefore = start
	): void {
		const d = display();
		writeDisplay(
			d.slice(0, start) + insert + d.slice(end),
			start + insert.length,
			source,
			caretBefore
		);
	}

	// ── CST inline widget ────────────────────────────────────────────────────

	function handleCstWidget(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		if (deps.isRevealing()) return false;
		if (caretOffset === null) return false;
		const node = deps.node;
		// Forward keys enter the widget after the caret, backward keys the one before, so
		// a caret between two adjacent widgets enters the one the key is aimed at.
		const direction = e.key === 'ArrowRight' || e.key === 'Delete' ? 'forward' : 'backward';
		const widgetAt = widgetAtCursor(caretOffset, inlinesOf(node), node.raw, direction);
		if (!widgetAt) return false;

		// Unchorded only: a modifier makes the key a word-scoped platform command, and
		// entering here would swap that word-step for the modal widget-selected state.
		const plainEdgeKey = !e.shiftKey && !hasModifier(e);
		const enterFromRight =
			plainEdgeKey && widgetAt.atRight && (e.key === 'ArrowLeft' || e.key === 'Backspace');
		const enterFromLeft =
			plainEdgeKey && !widgetAt.atRight && (e.key === 'ArrowRight' || e.key === 'Delete');
		if (enterFromRight || enterFromLeft) {
			const isDestructive = e.key === 'Backspace' || e.key === 'Delete';
			const policy = deps.widgetEdgePolicy?.(widgetAt) ?? getInlineWidgetEditing(widgetAt.kind);
			// A step-over widget reads as one character to navigation, so decline and let
			// native carry the caret across. Only navigation steps over; a destructive key
			// still runs the atomic-delete branch below.
			if (!isDestructive && policy?.onEdge === 'step-over') return false;
			e.preventDefault();
			deps.setSnapTarget(null);
			if (isDestructive && policy?.deleteGranularity === 'atomic' && !deps.isReading()) {
				// One press takes the whole construct, anchored at the pre-delete caret so
				// Ctrl+Z lands there.
				const newRaw = node.raw.slice(0, widgetAt.start) + node.raw.slice(widgetAt.end);
				void deps.blockEdit.updateBlockContent(deps.index, newRaw, caretOffset, widgetAt.start);
				deps.setPendingCursor(widgetAt.start, 'widget');
				return true;
			}
			// `onEdge: 'select'`, plus the reveal-capable kinds `enterWidget` routes to
			// their source reveal instead.
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

	function selectIslandWhole(el: HTMLElement): void {
		const sel = window.getSelection();
		if (!sel) return;
		const range = document.createRange();
		range.selectNode(el);
		sel.removeAllRanges();
		sel.addRange(range);
	}

	function handleIsland(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		// Modifier chords stay native; the island rules own only the plain edge presses.
		const isDestructive = !hasModifier(e) && (e.key === 'Backspace' || e.key === 'Delete');
		const isTyping = isPlainTypingKey(e);
		if (!isDestructive && !isTyping) return false;

		// Island-free blocks, the common case, skip the per-keystroke DOM scan entirely.
		if (!deps.hasIslands()) return false;

		const el = deps.getEl();
		if (!el) return false;
		const islands = islandsInDom(el);
		if (islands.length === 0) return false;

		// Second press: the native selection already wraps a replace island, so delete its
		// whole hidden range through the CST as one undo entry.
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

		// First press: selecting the whole island is the only visible thing to eat, since
		// the range it hides has no on-screen bytes of its own.
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

		// A step-over island is transparent to the adjacent real byte; at a true block
		// boundary there is none, so fall through and let block merge fire.
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
		// Cross-browser defence: some engines drop printable keys at an element-level caret
		// adjacent to a contenteditable=false island. Chromium types natively, masking this
		// branch in e2e, so it is unit-pinned instead.
		if (isTyping && !caretIsInTextContent(el, window.getSelection())) {
			e.preventDefault();
			editDisplay(caretOffset, caretOffset, e.key);
			return true;
		}
		return false;
	}

	// ── Ambient marker overlap ─────────────────────────────────────────────────

	// A selection reaching into the contenteditable="false" ambient span blocks native
	// Backspace/Delete silently — no beforeinput fires — so delete through the CST.
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

	// ── Hidden structural suffix ───────────────────────────────────────────────

	/**
	 * Delete at the content end of a block whose own structure sits after it: the merge this press
	 * would reach concatenates past that suffix, so the press is consumed. The rule itself lives in
	 * `hidden-suffix.ts`; the command arm asks the same question from its own coordinates.
	 */
	function handleHiddenSuffixDelete(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		if (e.key !== 'Delete') return false;
		if (e.shiftKey || hasModifier(e)) return false;
		if (caretOffset === null || hasSelectionHelper()) return false;
		if (caretOffset !== getContentRange(deps.node).end) return false;
		return hidesStructuralSuffix(deps.getEl(), deps.node, display().length) && preventing(e);
	}

	const preventing = (e: KeyboardEvent): true => {
		e.preventDefault();
		return true;
	};

	// ── Hidden construct edge (the destructive arm) ────────────────────────────

	/**
	 * A plain Backspace/Delete against an inline construct's unpainted delimiter run. The byte
	 * native would take there is one the reader never saw, so the rewrite takes the adjacent
	 * CONTENT character instead — and the delimiters it leaves enclosing nothing with it, since a
	 * pair around no content is invisible in a mode that paints neither (live-mode.md § 4.4).
	 */
	function handleConstructEdgeDelete(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
		if (e.shiftKey || hasModifier(e)) return false;
		if (caretOffset === null || hasSelectionHelper()) return false;
		const el = deps.getEl();
		if (!el || !revealsNoMarkers(el)) return false;
		// The landable start is visual column 0, where Backspace is a block gesture (merge or
		// inert): an atomic run straddling the start would otherwise take the first visible
		// glyph forward (GH #108).
		if (e.key === 'Backspace') {
			const bounds = landableRawBounds(el, deps.getAmbientLength());
			if (bounds && caretOffset <= bounds.start) return false;
		}
		const deletion = resolveEdgeDeletion({
			display: display(),
			content: getContentRange(deps.node),
			caret: caretOffset,
			direction: e.key === 'Backspace' ? 'backward' : 'forward',
			inlines: inlinesOf(deps.node)
		});
		if (!deletion) return false;
		e.preventDefault();
		deps.setSnapTarget(null);
		// A press with no sound rewrite still belongs here: leaving it to the engine paints the
		// delimiters it was hiding, so the arm takes the key and writes nothing.
		if ('swallow' in deletion) return true;
		writeDisplay(deletion.raw, deletion.caret, 'construct-delete', caretOffset);
		return true;
	}

	// ── Pending marks (the toggle seat) ────────────────────────────────────────

	/**
	 * A printable key while a collapsed-caret toggle has marks pending. The marks are the newer
	 * instruction about these same bytes, so they outrank the arrival side the seat below reads
	 * (live-mode.md § 4.2) and this arm runs first: the byte is written wrapped in the marks the caret's
	 * chain lacks, and escaped out of the constructs it carries, in one commit.
	 */
	function handlePendingMarks(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		if (deps.isReading()) return false;
		if (!isPlainTypingKey(e) || caretOffset === null || hasSelectionHelper()) return false;
		// Locally sound like the seat below: only a surface that paints no delimiter can be asked
		// to write one the user never sees. A mode flip clears the marks, so this strands nothing.
		const el = deps.getEl();
		if (!el || !revealsNoMarkers(el)) return false;
		// Spend on the preconditions, not on the outcome: one insertion was promised the set,
		// and this is it whether or not the rewrite below finds anything to do.
		const marks = deps.pendingMarks.consume();
		if (!marks) return false;
		const marked = resolveMarkedInsertion(
			display(),
			caretOffset,
			e.key,
			marks,
			inlinesOf(deps.node)
		);
		if (!marked) return false;
		e.preventDefault();
		deps.setSnapTarget(null);
		writeDisplay(marked.raw, marked.caret, 'pending-marks', caretOffset);
		return true;
	}

	// ── Hidden construct edge (the typing seat) ────────────────────────────────

	/**
	 * A printable key at an inline construct's unpainted delimiter run. The DOM caret cannot
	 * carry the answer — Chromium canonicalizes a collapsed caret upstream across a
	 * non-rendered run, so seating one past the run is normalized away before the insertion —
	 * so the byte is written through the CST at the offset the policy and arrival name.
	 */
	function handleConstructSeat(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		if (!isPlainTypingKey(e) || caretOffset === null || hasSelectionHelper()) return false;
		const el = deps.getEl();
		if (!el || !revealsNoMarkers(el)) return false;
		const seat = resolveEdgeSeat(
			caretOffset,
			inlinesOf(deps.node),
			deps.getEdgeAffinity(),
			deps.node.raw
		);
		if (!seat) return false;
		e.preventDefault();
		deps.setSnapTarget(null);
		// The kind rides the trace: the seam's whole job is deciding which construct owns the
		// byte, so a trace line that does not name it cannot be read.
		editDisplay(seat.offset, seat.offset, e.key, `seat:${seat.kind}`, caretOffset);
		return true;
	}

	function handleKeydown(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		// First: a pending mark is an explicit instruction about the very next byte, so it
		// outranks every classification below, which decide by where the caret happens to be.
		if (handlePendingMarks(e, caretOffset)) return true;
		if (handleCstWidget(e, caretOffset)) return true;
		// Islands and the ambient marker are destructive-only view guards, so reading mode
		// skips both wholesale; the widget branch above still selects, committing nothing.
		if (deps.isReading()) return false;
		if (handleIsland(e, caretOffset)) return true;
		if (handleAmbient(e)) return true;
		// Last: the more specific construct classes above still own a key aimed at one of
		// theirs, and these claim only what would otherwise reach native editing or the
		// block-merge command.
		if (handleHiddenSuffixDelete(e, caretOffset)) return true;
		if (handleConstructEdgeDelete(e, caretOffset)) return true;
		if (handleConstructSeat(e, caretOffset)) return true;
		return false;
	}

	return { handleKeydown };
}
