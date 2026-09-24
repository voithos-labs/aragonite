/**
 * The one place a caret-edge key is decided in a prose block. A plain Backspace, Delete or
 * printable key at a caret edge resolves against a declared policy: the inline construct's when
 * one sits beside the caret, the ancestor container's for a key at the content start. Never
 * native contenteditable editing, which would corrupt the bytes those constructs stand for
 * (G4.12).
 */

import type { BlockEditActions } from '../../../action-contracts';
import type { NodeView } from '../../../core/node-views';
import type { LinkReferenceResolverRef } from '../../../editor-keys';
import type { InlineNode } from '../../../core/nodes';
import type { InlineWidgetEditingPolicy } from '../../../core/inline/inline-widgets';
import { resolvedInlineContent } from '../../../core/inline/inline-cache';
import type { GrammarView } from '../../../schema/block-openers';
import { getContentRange } from '../../../core/inline';
import { getInlineWidgetEditing } from '../../../core/inline/inline-widgets';
import { trimTrailingLineEnding, trailingLineEnding } from '../../../core/lines';
import { type RawOffset } from '../../../cursor/coordinate-spaces';
import type { EdgeAffinity } from '../../../cursor/edge-affinity';
import type { PendingMarksState } from '../../../cursor/pending-marks';
import {
	landableRawBounds,
	revealsNoMarkers,
	screenVisibilityOf
} from '../../../cursor/widget-offset';
import { ambientSpanOf } from '../../../ambient/ambient-dom';
import { recordIslandKeyScan } from '../../../perf/instruments';
import { caretIsInTextContent, hasModifier, isPlainTypingKey } from './click-snap-guard';
import { createMarkerCompletion } from './marker-completion';
import {
	resolveEdgeDeletion,
	type DeleteDirection,
	type EdgeDeletion,
	type EdgeDeletionSurface
} from './construct-edge-delete';
import { resolveEdgeSeat, type EdgeSeat } from './edge-seat';
import { replaceRangeRaw } from './live-selection-edit';
import { resolveMarkedInsertion } from './pending-mark-insert';
import { widgetAtCursor } from './widget-adjacency';
import { noteOwnPair, resolveDelimiterAutoPair } from './delimiter-autopair';
import type { BlockAutoPairs } from './auto-pair-record';
import { soleProseReparse } from './screen-diff';

/** Whether `line` still parses back as `node`'s kind in the editor's grammar, which the auto-pair
 *  resolver checks. */
export function keepsBlockKind(node: NodeView, line: string, grammar: GrammarView): boolean {
	return (
		soleProseReparse(line + trailingLineEnding(node.raw), { grammar })?.block.kind === node.kind
	);
}

/** The part of the inline-widget editing policy the built-in widget rules reuse, in the same
 *  terms but without widening the public API. */
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
	/** The nearest ancestor container, or null at the document root. A key at the content start
	 *  resolves against its declaration. */
	get containerParent(): NodeView | null;
	get linkRef(): LinkReferenceResolverRef;
	/** The editor's grammar, the one the render path drew widgets with. */
	grammar: GrammarView;
	getEl: () => HTMLElement | null;
	getAmbientLength: () => number;
	/** The container's marker prefix this block renders under, which the join rules read a
	 *  candidate back through. Optional because a block that is not a container's child draws
	 *  none, and '' is the right answer there rather than an inherited one. */
	getAmbientPrefix?: () => string;
	/** Whether this block carries any decoration widgets. It reads the same source the render
	 *  drew from, so a false cannot disagree with the DOM and safely skips the scan. */
	hasIslands: () => boolean;
	/** Anchor/focus raw-content offsets of the live selection, or null when collapsed. */
	getRawSelection: () => { start: RawOffset; end: RawOffset } | null;
	blockEdit: BlockEditActions;
	/** Remember a caret offset for the restore after the next render, tagged with the gesture for
	 *  the debug trace. `writtenText` is the text that offset counts into, since a kind that
	 *  rewrites bytes on commit shifts it; omit it where the caret sits ahead of every changed
	 *  byte. */
	setPendingCursor: (offset: number | null, source: string, writtenText?: string) => void;
	setSnapTarget: (offset: number | null) => void;
	/** A widget's source is showing: the CST still calls it atomic, but the DOM holds editable
	 *  text, so the widget branch does nothing and lets native editing run. */
	isRevealing: () => boolean;
	/** Enter the widget, either by showing its source or by selecting it. This dispatch decides
	 *  which widget a key is aimed at; the callback decides what entering it means. */
	enterWidget: (
		widget: { start: number; end: number; kind: InlineNode['kind'] },
		fromTrailingEdge: boolean
	) => void;
	/**
	 * Replace the edge policy for a widget this block renders on its own terms, where the kind's
	 * registration does not apply: a policy names something the user can do, and a block that
	 * draws none of it must answer differently rather than half-work. `undefined` keeps the
	 * registered policy.
	 */
	widgetEdgePolicy?: (widget: {
		start: number;
		end: number;
		kind: InlineNode['kind'];
	}) => EdgePolicy | undefined;
	/** Reading mode: the decoration-widget and marker-prefix branches do nothing at all, and the
	 *  widget branch writes nothing, though it still selects. */
	isReading: () => boolean;
	/** Which side the caret arrived from, which decides where a typed byte lands; null when
	 *  nothing recorded one. */
	getEdgeAffinity: () => EdgeAffinity | null;
	/** Typing a closing delimiter leaves the caret meaning outside the construct it finished. */
	noteOutside?: () => void;
	/** The constructs a toggle at a collapsed caret promised the next insertion. Read and spent
	 *  here: the first byte after the chord is the insertion they were waiting for. */
	pendingMarks: PendingMarksState;
	/** This block's view of the editor's record of the pair the auto-pair last wrote, which the
	 *  auto-pair answers below read and a pair written here renews. */
	ownPairs: BlockAutoPairs;
	/** How this block stores a rewrite, so the edge rules read a candidate back the way it will be
	 *  saved. Required: a table cell that fell back to `block` would refuse its own text. */
	installedAs: EdgeDeletionSurface;
}

export interface EdgePolicyDispatch {
	/** A plain edge key against a caret-adjacent construct. Returns whether the event
	 *  was consumed; a false return leaves the key to the shared keymap below. */
	handleKeydown(e: KeyboardEvent, caretOffset: RawOffset | null): boolean;
	/** The order `handleKeydown` walks, ids and reasons only. The order is what the rule fixes
	 *  (G4.12), so it is readable here rather than something a test has to re-derive. */
	readonly arms: readonly { id: string; reason: string }[];
}

/**
 * One family of gestures and what it takes on a keydown, in the order the families outrank each
 * other. Declared instead of a chain of `if`s so a new family is a visible entry with its reason
 * attached. Not policy rows: this is a total order over families, where a policy row answers a
 * per-construct question. `test/invariants/lint/policy-arm-census.test.ts` asserts the split.
 */
interface DispatchArm {
	id: string;
	reason: string;
	/** A cut ends the dispatch as unhandled when it fires, leaving the key to the keymap below;
	 *  every other entry consumes the event. */
	cut?: boolean;
	claims: (e: KeyboardEvent, caretOffset: RawOffset | null) => boolean;
}

export function createEdgePolicyDispatch(deps: EdgePolicyDispatchDeps): EdgePolicyDispatch {
	const markerCompletion = createMarkerCompletion();
	const arms: readonly DispatchArm[] = [
		{
			id: 'pending-marks',
			reason:
				'an explicit instruction about the very next byte, so it outranks every classification below, which decide by where the caret happens to be',
			claims: handlePendingMarks
		},
		{
			id: 'transitional-hard-break',
			reason:
				'a hard break at the end of a block has no following line yet, so its own position is where the next byte starts that line',
			claims: handleTransitionalHardBreak
		},
		{
			id: 'cst-widget',
			reason: 'a key aimed at an atomic construct is the widget branch’s before any byte rule',
			claims: handleCstWidget
		},
		{
			id: 'reading-mode',
			reason:
				'inline widgets and the container’s marker prefix are destructive-only view guards, so reading skips every branch below; the widget branch above still selects, committing nothing',
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
			claims: handleAmbient
		},
		// The three below handle only what would otherwise reach native editing or the block-merge
		// command; the more specific families above still take a key aimed at one of theirs.
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

	/** One rewrite of the displayed text, one CST commit. `caretBefore` anchors the undo entry, so
	 *  it is the caret before the edit: the rewrite's own start, unless a hidden run moved it. */
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

	/**
	 * The selected range in this block, or null at a plain caret: the one answer every branch
	 * below reads, so none of them can hold a second idea of what a held range is. It comes back
	 * empty for a selection whose ends both clamp into the marker prefix, which is still a range,
	 * so a branch that writes bytes checks `end > start` first.
	 */
	function heldRange(): { start: number; end: number } | null {
		return deps.getRawSelection();
	}

	// ── The shared helpers the branches below use ────────────────────────────

	/**
	 * Which mode a range rewrite is judged in. Past the reading-mode check, a block showing no
	 * markers is in live mode, the only mode with hidden delimiter runs to clean up; every other
	 * mode takes the literal edit the browser would have written.
	 */
	function joinSeamMode(el: HTMLElement): 'live' | undefined {
		return revealsNoMarkers(el) ? 'live' : undefined;
	}

	/** What the construct-edge rule (live-mode.md § 4.4) does with a destructive key here, or null
	 *  where the block draws its markers and the byte beside the caret is one the user can see. */
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
			installedAs: deps.installedAs,
			resolver: deps.linkRef?.current,
			grammar: deps.grammar
		});
	}

	/** A keypress with no safe rewrite writes nothing: the browser's version would show the
	 *  delimiters the rule was hiding. */
	function applyEdgeDeletion(deletion: EdgeDeletion, caretBefore: number): void {
		if ('swallow' in deletion) return;
		writeDisplay(deletion.raw, deletion.caret, 'construct-delete', caretBefore);
		// Pended after the write, since the write clears pending marks; the caret has not moved, so
		// the format waits for the next insertion (live-mode.md § 4.4).
		for (const kind of deletion.unwrappedMarks) deps.pendingMarks.toggle(kind);
	}

	/** Where a printable byte belongs when the caret sits at a hidden delimiter run
	 *  (live-mode.md § 4.2), or null when no run is touched and the caret's own offset stands. */
	function typingSeatAt(el: HTMLElement, caret: number, typed: string): EdgeSeat | null {
		if (!revealsNoMarkers(el)) return null;
		return resolveEdgeSeat(
			caret,
			inlinesOf(deps.node),
			deps.getEdgeAffinity(),
			deps.node.raw,
			screenVisibilityOf(el),
			typed,
			deps.linkRef?.current,
			deps.grammar
		);
	}

	/** A printable byte one of the branches took because the browser drops it at an element-level
	 *  caret. Over a selected range it replaces through the same join rules a mid-block range
	 *  takes; at a caret the hidden-run rules answer which side it lands on. */
	function writeTypedByte(
		el: HTMLElement,
		caretOffset: number,
		typed: string,
		source: string
	): void {
		const range = heldRange();
		if (range && range.end > range.start) {
			const edit = replaceRangeRaw(
				deps.node,
				range,
				typed,
				joinSeamMode(el),
				deps.linkRef,
				deps.getAmbientPrefix?.() ?? ''
			);
			void deps.blockEdit.updateBlockContent(deps.index, edit.raw, range.start, edit.caret);
			deps.setPendingCursor(edit.caret, source, edit.raw);
			return;
		}
		const seatedAt = typingSeatAt(el, caretOffset, typed)?.offset ?? caretOffset;
		editDisplay(seatedAt, seatedAt, typed, source, caretOffset);
	}

	// ── CST inline widget ────────────────────────────────────────────────────

	function handleCstWidget(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		if (deps.isRevealing()) return false;
		if (caretOffset === null) return false;
		const node = deps.node;
		// Forward keys enter the widget after the caret, backward keys the one before, so
		// a caret between two adjacent widgets enters the one the key is aimed at.
		const direction = e.key === 'ArrowRight' || e.key === 'Delete' ? 'forward' : 'backward';
		const { grammar } = deps;
		const widgetAt = widgetAtCursor(caretOffset, inlinesOf(node), node.raw, direction, grammar);
		if (!widgetAt) return false;
		// Past the early return: every keystroke in every prose block reaches the line above, so
		// the work below stays off that path.
		const range = heldRange();

		// No modifier, and a collapsed caret: a modifier makes the key a word-scoped platform
		// command, and a selected range is an edit of that range, not an entry into a construct.
		const plainEdgeKey = !e.shiftKey && !hasModifier(e) && !range;
		const enterFromRight =
			plainEdgeKey && widgetAt.atRight && (e.key === 'ArrowLeft' || e.key === 'Backspace');
		const enterFromLeft =
			plainEdgeKey && !widgetAt.atRight && (e.key === 'ArrowRight' || e.key === 'Delete');
		if (enterFromRight || enterFromLeft) {
			const isDestructive = e.key === 'Backspace' || e.key === 'Delete';
			const policy =
				deps.widgetEdgePolicy?.(widgetAt) ?? getInlineWidgetEditing(widgetAt.kind, grammar);
			// A step-over widget reads as one character to navigation, so decline and let the
			// browser carry the caret across. Only navigation steps over; a destructive key
			// still runs the atomic-delete branch below.
			if (!isDestructive && policy?.onEdge === 'step-over') return false;
			e.preventDefault();
			deps.setSnapTarget(null);
			if (isDestructive && policy?.deleteGranularity === 'atomic' && !deps.isReading()) {
				// One keypress takes the whole construct, anchored at the caret before the delete
				// so Ctrl+Z lands there.
				const newRaw = node.raw.slice(0, widgetAt.start) + node.raw.slice(widgetAt.end);
				void deps.blockEdit.updateBlockContent(deps.index, newRaw, caretOffset, widgetAt.start);
				deps.setPendingCursor(widgetAt.start, 'widget');
				return true;
			}
			// `onEdge: 'select'`, plus the kinds `enterWidget` sends to their source instead of
			// selecting.
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
			writeTypedByte(el, caretOffset, e.key, 'widget');
			return true;
		}
		return false;
	}

	// ── Decoration widgets ───────────────────────────────────────────────────

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
		// Modifier chords stay with the browser; these rules take only the plain edge keys.
		const isDestructive = !hasModifier(e) && (e.key === 'Backspace' || e.key === 'Delete');
		const isTyping = isPlainTypingKey(e);
		if (!isDestructive && !isTyping) return false;

		// Blocks with no decoration widgets, the common case, skip the per-keystroke DOM scan.
		if (!deps.hasIslands()) return false;

		const el = deps.getEl();
		if (!el) return false;
		const islands = islandsInDom(el);
		if (islands.length === 0) return false;

		// Second keypress: the browser selection already wraps a replace widget, so delete its
		// whole hidden range through the CST as one undo entry.
		if (isDestructive) {
			const selection = heldRange();
			if (selection) {
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
				// A different non-empty selection: leave it to the normal delete paths.
				return false;
			}
		}

		if (caretOffset === null) return false;
		const contentLength = display().length;

		// First keypress: selecting the whole widget is the only visible thing to delete, since
		// the range it hides has no bytes of its own on screen.
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

		// A step-over widget is transparent to the real byte beside it; at a true block
		// boundary there is none, so fall through and let the block merge run.
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
			// The neighbouring byte in `raw` is not always the neighbouring real one: beside a
			// hidden delimiter run the construct-edge rule decides which byte a key takes
			// (§ 4.4), and this branch outranks it, so it asks instead of splicing.
			const deletion = edgeDeletionAt(el, caretOffset, direction);
			if (deletion) applyEdgeDeletion(deletion, caretOffset);
			else if (direction === 'backward') editDisplay(caretOffset - 1, caretOffset, '');
			else editDisplay(caretOffset, caretOffset + 1, '');
			return true;
		}
		// Cross-browser defence: some browsers drop printable keys at an element-level caret
		// next to a contenteditable=false widget. Chromium types them normally, which hides
		// this branch from e2e, so a unit test covers it.
		if (isTyping && !caretIsInTextContent(el, window.getSelection())) {
			e.preventDefault();
			writeTypedByte(el, caretOffset, e.key, 'island');
			return true;
		}
		return false;
	}

	// ── Container marker prefix overlap ────────────────────────────────────────

	// A selection reaching into the contenteditable="false" marker prefix blocks the browser's
	// Backspace and Delete silently, with no beforeinput, so delete through the CST instead.
	function handleAmbient(e: KeyboardEvent): boolean {
		if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
		const range = heldRange();
		if (!range) return false;
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
		// A selection holding only the marker prefix covers no content byte, so there is nothing
		// to delete and the press is consumed with no commit.
		if (range.end > range.start) {
			// Handled at keydown, so no `beforeinput` carries this range to the shared join rules:
			// this branch asks them here, or a literal splice would print the delimiter runs the
			// cut stranded (live-mode.md § 4.5).
			const edit = replaceRangeRaw(
				deps.node,
				range,
				'',
				joinSeamMode(el),
				deps.linkRef,
				deps.getAmbientPrefix?.() ?? ''
			);
			void deps.blockEdit.updateBlockContent(deps.index, edit.raw, range.start, edit.caret);
			deps.setPendingCursor(edit.caret, 'ambient-delete');
		}
		return true;
	}

	// ── Hidden construct edge (deleting) ───────────────────────────────────────

	/**
	 * A plain Backspace or Delete against an inline construct's hidden delimiter run: the rewrite
	 * takes the neighbouring content character instead of a byte the user never saw, plus any
	 * delimiters that leaves enclosing nothing (live-mode.md § 4.4).
	 */
	function handleConstructEdgeDelete(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
		if (e.shiftKey || hasModifier(e)) return false;
		if (caretOffset === null || heldRange()) return false;
		const el = deps.getEl();
		if (!el) return false;
		// The first offset the caret can sit at is visual column 0, where Backspace is a block
		// gesture (merge, or nothing): a hidden run straddling the start would otherwise take
		// the first visible character forward.
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

	// ── Pending marks from a toggle ────────────────────────────────────────────

	/**
	 * The byte that completes a hard break made at the end of a block. `insertHardBreak` writes
	 * `\\` plus a line ending there, but that ending is the block's own trailing one, so the
	 * display stops at the backslash and the caret has nowhere to sit past it. The next printable
	 * key supplies the following line: it lands after the break, not between the backslash and
	 * its newline, where it would read as content and undo the break.
	 */
	function handleTransitionalHardBreak(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		if (deps.isReading()) return false;
		if (!isPlainTypingKey(e) || caretOffset === null || heldRange()) return false;
		const d = display();
		// Only at the very end, and only when the block's last byte is the break's backslash.
		if (caretOffset !== d.length || !d.endsWith('\\')) return false;
		// An escaped backslash (`\\\\`) is content, not a break.
		if (d.endsWith('\\\\')) return false;
		// Backslash before ASCII punctuation is an escape (`\|`, `\*`), never a break's backslash.
		if (/^[!-/:-@[-`{-~]$/.test(e.key)) return false;
		const ending = trailingLineEnding(deps.node.raw);
		e.preventDefault();
		deps.setSnapTarget(null);
		const next = d + ending + e.key;
		writeDisplay(next, next.length, 'transitional-hard-break', caretOffset);
		return true;
	}

	/**
	 * A printable key while a toggle at a collapsed caret has marks pending. The marks are the
	 * newer instruction about the same bytes, so they outrank the arrival side the hidden-run
	 * branch below reads (live-mode.md § 4.2), and this branch runs first.
	 */
	function handlePendingMarks(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		if (deps.isReading()) return false;
		if (!isPlainTypingKey(e) || caretOffset === null || heldRange()) return false;
		// The same condition as the branch below: only a block that draws no delimiters can be
		// asked to write one the user never sees. Switching mode clears the marks, so nothing
		// is stranded.
		const el = deps.getEl();
		if (!el || !revealsNoMarkers(el)) return false;
		// Spent on the conditions above, not on the outcome: one insertion was promised the
		// marks, and this is it whether or not the rewrite below finds anything to do.
		const marks = deps.pendingMarks.consume();
		if (!marks) return false;
		const marked = resolveMarkedInsertion(
			display(),
			caretOffset,
			e.key,
			marks,
			inlinesOf(deps.node),
			deps.linkRef?.current,
			deps.grammar
		);
		if (!marked) return false;
		e.preventDefault();
		deps.setSnapTarget(null);
		writeDisplay(marked.raw, marked.caret, 'pending-marks', caretOffset);
		return true;
	}

	// ── Container marker completion ────────────────────────────────────────────

	/**
	 * A bare space at a child's content start while its container's marker lacks its space
	 * (`contentStartSpace`). Consumed, not written: the container's `rebuildRaw` writes it back
	 * with the next write inside, so inserting it here would double the marker's own space. It is
	 * taken once per child; a later space at the same position is content.
	 */
	function handleMarkerCompletion(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		const bareSpace = e.key === ' ' && !e.shiftKey && !hasModifier(e);
		if (!bareSpace || caretOffset === null || heldRange()) return false;
		const { node, containerParent, index } = deps;
		if (!markerCompletion.claimSpace(node, containerParent, index, caretOffset)) return false;
		e.preventDefault();
		return true;
	}

	// ── Hidden construct edge (typing) ─────────────────────────────────────────

	/**
	 * A printable key at an inline construct's hidden delimiter run. Chromium moves a collapsed
	 * caret back across a run it does not render, so the DOM caret cannot carry the answer; the
	 * byte is written through the CST at the offset the policy and the arrival side name.
	 */
	function handleConstructSeat(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		if (!isPlainTypingKey(e) || caretOffset === null || heldRange()) return false;
		// A delimiter typed over its own closing one is the auto-pair's step-over, handled on
		// beforeinput (delimiter-autopair.ts); placed outside the run it would be typed instead.
		const content = getContentRange(deps.node);
		const { grammar, linkRef, ownPairs } = deps;
		const text = display();
		const autoPair = resolveDelimiterAutoPair(text, content, caretOffset, e.key, linkRef, {
			ownPair: ownPairs.consult(text, caretOffset)
		});
		if (autoPair?.kind === 'step-over') return false;
		const el = deps.getEl();
		const seat = el && typingSeatAt(el, caretOffset, e.key);
		if (!seat) return false;
		e.preventDefault();
		deps.setSnapTarget(null);
		// Those rules decide where the byte lands; what a delimiter keystroke writes there is
		// still the auto-pair's answer, or a byte placed past a run would arrive without its
		// closing partner. The kind goes into the debug trace, naming the construct involved.
		const paired = resolveDelimiterAutoPair(text, content, seat.offset, e.key, linkRef, {
			ownPair: ownPairs.consult(text, seat.offset),
			keepsKind: (line) => keepsBlockKind(deps.node, line, grammar)
		});
		if (paired && paired.kind !== 'step-over') {
			noteOwnPair(ownPairs, text, paired);
			writeDisplay(paired.text, paired.caret, `seat:${seat.kind}`, caretOffset);
			if (paired.kind === 'close') deps.noteOutside?.();
			return true;
		}
		ownPairs.forget();
		editDisplay(seat.offset, seat.offset, e.key, `seat:${seat.kind}`, caretOffset);
		return true;
	}

	return { handleKeydown, arms };
}
