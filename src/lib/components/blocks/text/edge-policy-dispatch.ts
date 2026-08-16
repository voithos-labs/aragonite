/**
 * The single caret-edge dispatch (G4.12): a plain Backspace/Delete or printable key at a caret
 * edge in a prose block resolves against a declarative policy — the construct class's for an
 * inline neighbour, the ancestor container's for a content-start key — never native
 * contenteditable mutation, which would corrupt the atomic bytes those stand for.
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
import {
	landableRawBounds,
	revealsNoMarkers,
	screenVisibilityOf
} from '../../../cursor/widget-offset';
import { ambientSpanOf } from '../../../ambient/ambient-dom';
import { recordIslandKeyScan } from '../../../perf/instruments';
import { caretIsInTextContent, hasModifier, isPlainTypingKey } from './click-snap-guard';
import { completesContainerMarker } from './marker-completion';
import {
	resolveEdgeDeletion,
	type DeleteDirection,
	type EdgeDeletion,
	type EdgeDeletionSurface
} from './construct-edge-delete';
import { hidesStructuralSuffix } from './hidden-suffix';
import { resolveEdgeSeat, type EdgeSeat } from './edge-seat';
import { resolveSelectionEdit } from './live-selection-edit';
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
	/** The nearest ancestor container, or null at the document root — the declaration a
	 *  content-start key resolves against. */
	get containerParent(): NodeView | null;
	get linkRef(): LinkReferenceResolverRef | undefined;
	getEl: () => HTMLElement | null;
	getAmbientLength: () => number;
	/** The container prefix this surface renders under, which the join seam reads a candidate back
	 *  through. Optional because a surface that is not a container's child paints none, and '' is
	 *  the right answer there rather than an inherited assumption. */
	getAmbientPrefix?: () => string;
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
	/** What this surface installs a rewrite as, so the seams read a candidate back the way it will
	 *  be stored. Required: a cell answering `block` by silence would refuse its own text. */
	installedAs: EdgeDeletionSurface;
}

export interface EdgePolicyDispatch {
	/** A plain edge key against a caret-adjacent construct. Returns whether the event
	 *  was consumed; a false return leaves the key to the shared keymap below. */
	handleKeydown(e: KeyboardEvent, caretOffset: RawOffset | null): boolean;
	/** The declared order `handleKeydown` walks, ids and reasons only. The ORDER is the seam
	 *  (G4.12), so it is readable rather than something a test can only re-derive. */
	readonly arms: readonly { id: string; reason: string }[];
}

/**
 * One gesture family's claim on a keydown, in the order the families outrank each other. Declared
 * rather than a chain of `if`s so a new family is a visible entry carrying its reason. Deliberately
 * NOT policy rows: this is a total order over FAMILIES, where a row answers a per-construct
 * question — the split is asserted by `test/invariants/lint/policy-arm-census.test.ts`.
 */
interface DispatchArm {
	id: string;
	reason: string;
	/** A CUT ends the dispatch UNCLAIMED when it fires, leaving the key to the keymap below;
	 *  every other arm consumes the event. */
	cut?: boolean;
	claims: (e: KeyboardEvent, caretOffset: RawOffset | null) => boolean;
}

export function createEdgePolicyDispatch(deps: EdgePolicyDispatchDeps): EdgePolicyDispatch {
	const arms: readonly DispatchArm[] = [
		{
			id: 'pending-marks',
			reason:
				'an explicit instruction about the very next byte, so it outranks every classification below, which decide by where the caret happens to be',
			claims: handlePendingMarks
		},
		{
			id: 'cst-widget',
			reason: 'a key aimed at an atomic construct is the widget branch’s before any byte rule',
			claims: handleCstWidget
		},
		{
			id: 'reading-mode',
			reason:
				'islands and the ambient marker are destructive-only view guards, so reading skips every arm below; the widget arm above still selects, committing nothing',
			cut: true,
			claims: () => deps.isReading()
		},
		{
			id: 'decoration-island',
			reason: 'a view-only range with no on-screen bytes of its own to eat',
			claims: handleIsland
		},
		{
			id: 'ambient-marker',
			reason:
				'a selection into the ambient span blocks native delete silently, with no beforeinput',
			claims: (e) => handleAmbient(e)
		},
		// The four below claim only what would otherwise reach native editing or the block-merge
		// command; the more specific families above still own a key aimed at one of theirs.
		{
			id: 'hidden-suffix-delete',
			reason: 'the merge this press would reach concatenates past the block’s own hidden structure',
			claims: handleHiddenSuffixDelete
		},
		{
			id: 'construct-edge-delete',
			reason: 'a destructive key beside an unpainted delimiter run takes content, never a marker',
			claims: handleConstructEdgeDelete
		},
		{
			id: 'marker-completion',
			reason: 'the container re-emits this space itself, so writing it here would double it',
			claims: handleMarkerCompletion
		},
		{
			id: 'construct-seat',
			reason: 'the DOM caret cannot express which side of a zero-width run a typed byte belongs on',
			claims: handleConstructSeat
		}
	];

	function handleKeydown(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		for (const arm of arms) {
			if (arm.claims(e, caretOffset)) return arm.cut !== true;
		}
		return false;
	}

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

	// ── The seams the arms below defer to ────────────────────────────────────

	/**
	 * The rung a range rewrite can be asked about. Past the reading cut a surface revealing no
	 * marker is live, the one mode whose seam has unpainted runs to clean; every other rung takes
	 * the literal edit the engine would have written.
	 */
	function joinSeamMode(el: HTMLElement): 'live' | undefined {
		return revealsNoMarkers(el) ? 'live' : undefined;
	}

	/** What the construct-edge rule (live-mode.md § 4.4) does with a destructive key here, or null
	 *  where the surface paints its markers and the byte beside the caret is one the reader saw. */
	function edgeDeletionAt(
		el: HTMLElement,
		caret: number,
		direction: DeleteDirection
	): EdgeDeletion | null {
		if (!revealsNoMarkers(el)) return null;
		return resolveEdgeDeletion({
			display: display(),
			content: getContentRange(deps.node),
			caret,
			direction,
			screen: screenVisibilityOf(el),
			inlines: inlinesOf(deps.node),
			installedAs: deps.installedAs
		});
	}

	/** A press with no sound rewrite writes nothing: the engine's version would paint the
	 *  delimiters the rule was hiding. */
	function applyEdgeDeletion(deletion: EdgeDeletion, caretBefore: number): void {
		if ('swallow' in deletion) return;
		writeDisplay(deletion.raw, deletion.caret, 'construct-delete', caretBefore);
	}

	/** Where a printable byte belongs when the caret sits at an unpainted delimiter run
	 *  (live-mode.md § 4.2), or null when no run is touched and the caret's own offset stands. */
	function typingSeatAt(el: HTMLElement, caret: number, typed: string): EdgeSeat | null {
		if (!revealsNoMarkers(el)) return null;
		return resolveEdgeSeat(
			caret,
			inlinesOf(deps.node),
			deps.getEdgeAffinity(),
			deps.node.raw,
			screenVisibilityOf(el),
			typed
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
			// This branch owns only the fact that the engine drops the key beside a widget; which
			// side of an unpainted run the byte belongs on is still the seat's answer.
			const seatedAt = typingSeatAt(el, caretOffset, typed)?.offset ?? caretOffset;
			const newRaw = node.raw.slice(0, seatedAt) + typed + node.raw.slice(seatedAt);
			const postEdit = seatedAt + typed.length;
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
		const direction: DeleteDirection | null =
			e.key === 'Backspace' && caretOffset > 0
				? 'backward'
				: e.key === 'Delete' && caretOffset < contentLength
					? 'forward'
					: null;
		if (direction !== null) {
			e.preventDefault();
			// The adjacent RAW byte is not always the adjacent real one: beside an unpainted
			// delimiter run the construct-edge rule owns which byte a press takes (§ 4.4), and
			// this arm outranks it, so it asks rather than splices.
			const deletion = edgeDeletionAt(el, caretOffset, direction);
			if (deletion) applyEdgeDeletion(deletion, caretOffset);
			else if (direction === 'backward') editDisplay(caretOffset - 1, caretOffset, '');
			else editDisplay(caretOffset, caretOffset + 1, '');
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
			// Consumed at KEYDOWN, so no `beforeinput` carries this range to the shared seam: the arm
			// asks it here, or a literal splice prints the runs the cut stranded (live-mode.md § 4.5).
			const cleaned = resolveSelectionEdit(
				deps.node,
				range,
				'',
				joinSeamMode(el),
				deps.linkRef,
				deps.getAmbientPrefix?.() ?? ''
			);
			const shown = display();
			const newRaw =
				cleaned?.raw ??
				shown.slice(0, range.start) + shown.slice(range.end) + trailingLineEnding(deps.node.raw);
			const caret = cleaned?.caret ?? range.start;
			void deps.blockEdit.updateBlockContent(deps.index, newRaw, range.start, caret);
			deps.setPendingCursor(caret, 'ambient-delete');
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
	 * A plain Backspace/Delete against an inline construct's unpainted delimiter run: the rewrite
	 * takes the adjacent CONTENT character instead of a byte the reader never saw, plus the
	 * delimiters that leaves enclosing nothing (live-mode.md § 4.4).
	 */
	function handleConstructEdgeDelete(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
		if (e.shiftKey || hasModifier(e)) return false;
		if (caretOffset === null || hasSelectionHelper()) return false;
		const el = deps.getEl();
		if (!el) return false;
		// The landable start is visual column 0, where Backspace is a block gesture (merge or
		// inert): an atomic run straddling the start would otherwise take the first visible
		// glyph forward.
		if (e.key === 'Backspace') {
			const bounds = landableRawBounds(el, deps.getAmbientLength());
			if (bounds && caretOffset <= bounds.start) return false;
		}
		const deletion = edgeDeletionAt(
			el,
			caretOffset,
			e.key === 'Backspace' ? 'backward' : 'forward'
		);
		if (!deletion) return false;
		e.preventDefault();
		deps.setSnapTarget(null);
		applyEdgeDeletion(deletion, caretOffset);
		return true;
	}

	// ── Pending marks (the toggle seat) ────────────────────────────────────────

	/**
	 * A printable key while a collapsed-caret toggle has marks pending. Marks are the newer
	 * instruction about the same bytes, so they outrank the arrival side the seat below reads
	 * (live-mode.md § 4.2) and this arm runs first.
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

	// ── Container marker completion ────────────────────────────────────────────

	/**
	 * A bare space at the content start of an empty child whose container declares
	 * `contentStartSpace`. Consumed, not written: the container's `rebuildRaw` re-emits it the
	 * moment content arrives, so inserting it here would double the marker's own space.
	 */
	function handleMarkerCompletion(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		const bareSpace = e.key === ' ' && !e.shiftKey && !hasModifier(e);
		if (!bareSpace || caretOffset === null || hasSelectionHelper()) return false;
		if (!completesContainerMarker(deps.node, deps.containerParent, caretOffset)) return false;
		e.preventDefault();
		return true;
	}

	// ── Hidden construct edge (the typing seat) ────────────────────────────────

	/**
	 * A printable key at an inline construct's unpainted delimiter run. Chromium canonicalizes a
	 * collapsed caret upstream across a non-rendered run, so the DOM caret cannot carry the answer
	 * and the byte is written through the CST at the offset the policy and arrival name.
	 */
	function handleConstructSeat(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		if (!isPlainTypingKey(e) || caretOffset === null || hasSelectionHelper()) return false;
		const el = deps.getEl();
		const seat = el && typingSeatAt(el, caretOffset, e.key);
		if (!seat) return false;
		e.preventDefault();
		deps.setSnapTarget(null);
		// The kind rides the trace: the seam's whole job is deciding which construct owns the
		// byte, so a trace line that does not name it cannot be read.
		editDisplay(seat.offset, seat.offset, e.key, `seat:${seat.kind}`, caretOffset);
		return true;
	}

	return { handleKeydown, arms };
}
