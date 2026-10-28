/**
 * Where a prose block or a table cell decides two things: a key aimed at an inline construct or
 * the container's marker, by a declared policy rather than native editing, which would corrupt the
 * bytes those constructs stand for (G4.12); and every collapsed Backspace or Delete, by key or soft
 * keyboard, at `beforeinput` (`deleteAtCaret`), its widget answer at a chord's keydown too
 * (`deleteBeside`). Where a typed byte lands is `next-insertion.ts`'s.
 */

import type { ContentWrite } from '../../../action-contracts';
import type { NodeView } from '../../../core/node-views';
import type { InlineNode } from '../../../core/nodes';
import type { InlineWidgetEditingPolicy } from '../../../core/inline/inline-widgets';
import { resolvedInlineContent } from '../../../core/inline/inline-cache';
import { getContentRange, structuralSuffix } from '../../../core/inline';
import { getInlineWidgetEditing } from '../../../core/inline/inline-widgets';
import { isBlankText, trimTrailingLineEnding } from '../../../core/lines';
import { type RawOffset } from '../../../core/coordinate-spaces';
import type { BlockPendingMarks } from '../../../caret/pending-marks';
import type { InsideCloserView } from '../../../caret/inside-closer';
import { keptBlockText, hidesBlockPrefix, type EditedBlock } from '../../../browser/block-text';
import { landableRawBounds, visibleWalkText } from '../../../browser/offsets';
import { markerPrefixOf, hidingScreenOf } from '../../../browser/painted';
import type { CaretWriter } from '../../../browser/caret-writer';
import { deleteExtent, type DeleteAnswer, type DeleteSpan } from '../../../caret/delete-extent';
import type { DeleteDirection, DeleteIntent } from '../../../browser/input';
import { lineEdgeOffset } from '../../../browser/visual-lines';
import { recordIslandKeyScan } from '../../../perf/instruments';
import { hasModifier, isBareKey, isPlainTypingKey } from './click-snap-guard';
import { caretIsInTextContent, readNativeSelection } from '../../../browser/selection-read';
import { createMarkerCompletion } from './marker-completion';
import { resolveEdgeDeletion, type EdgeDeletion } from './construct-edge-delete';

import { replaceRangeInLeaf } from '../../../tree-operations/leaf-range';
import { widgetAtCursor, widgetsIn, type WidgetAtCursor } from './widget-adjacency';
import type { CaretUnitSource } from '../../../selection/shared-keydown';
import type { Reading } from '../../../schema/reading';
import type { StoredAs } from '../../../schema/stored-as';
import { rangeWrite, withOwnEnding, type TextWrite } from '../editable/surface-write';

/** The part of the inline-widget editing policy the built-in widget rules reuse, in the same
 *  terms but without widening the public API. */
export type EdgePolicy = Pick<InlineWidgetEditingPolicy, 'onEdge' | 'deleteGranularity'>;

const REPLACE_ISLAND_POLICY: EdgePolicy = {
	onEdge: 'step-over',
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
	/** How the editor reads its bytes, the grammar the render path drew widgets with included. */
	get reading(): Reading;
	getEl: () => HTMLElement | null;
	/** Where this block's bytes are stored, read when a rewrite asks, so a cut reads its candidate
	 *  back as it will be kept: a cell's text as text, a list item's behind its marker. */
	storedAs: () => StoredAs;
	/** Whether this block carries any decoration widgets. It reads the same source the render
	 *  drew from, so a false cannot disagree with the DOM and safely skips the scan. */
	hasIslands: () => boolean;
	/** Anchor/focus raw-content offsets of the live selection, or null when collapsed. */
	getRawSelection: () => { start: RawOffset; end: RawOffset } | null;
	/** The block's one write to its own text, which anchors undo and puts the caret back. */
	writeText: (write: TextWrite) => ContentWrite;
	/** Write the space that finishes the container's marker in front of this block, as one write
	 *  of the container's own line. */
	completeMarker: () => void;
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
	/** Replace the edge policy for a widget this block draws on its own terms, where the kind's
	 *  registered policy names a gesture the block cannot show. `undefined` keeps the registered one. */
	widgetEdgePolicy?: (widget: {
		start: number;
		end: number;
		kind: InlineNode['kind'];
	}) => EdgePolicy | undefined;
	/** Reading mode: the decoration-widget and marker-prefix branches do nothing at all, and the
	 *  widget branch writes nothing, though it still selects. */
	isReading: () => boolean;
	/** The block's pending marks, where a press that unwraps a construct pends the kinds it took. */
	pendingMarks: BlockPendingMarks;
	/** The editor's caret writer, which selects a decoration widget whole. */
	caretWriter: CaretWriter;
	/** The caret Edit link left before a hidden closer, which a letter taken back keeps there. */
	insideCloser: () => InsideCloserView;
}

export interface EdgePolicyDispatch {
	/** A plain edge key against a caret-adjacent construct. Returns whether the event
	 *  was consumed; a false return leaves the key to the shared keymap below. */
	handleKeydown(e: KeyboardEvent, caretOffset: RawOffset | null): boolean;
	/** The order `handleKeydown` walks, ids and reasons only. The order is what the rule fixes
	 *  (G4.12), so it is readable here rather than something a test has to re-derive. */
	readonly arms: readonly { id: string; reason: string }[];
	/** The widgets and replace decorations a horizontal arrow crosses whole, for the shared
	 *  keydown, which decides that step before any arm here runs. */
	readonly inlineUnits: CaretUnitSource;
	/** Writes `typed` at `caret` when the caret sits right before a widget that ends the block,
	 *  where Firefox fires the insertion's `beforeinput` and inserts nothing. True if written. */
	typeBeforeClosingWidget(caret: number, typed: string): boolean;
	/** A collapsed delete that reached `beforeinput`, by the rules the keys above follow, then the
	 *  delete rule; declined while a shown source holds bytes the tree hasn't seen. */
	deleteAtCaret(caret: number, intent: DeleteIntent): DeleteAnswer;
	/** Takes or enters what a delete of any unit facing `direction` meets at `caret`: a widget by
	 *  its policy, or, outside reading mode, a replace decoration, selected whole. True when it did. */
	deleteBeside(caret: number, direction: DeleteDirection): boolean;
}

/** One family of gestures, listed in the order the families outrank each other. A family is not a
 *  per-construct policy row; `policy-arm-census.test.ts` checks that split. */
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
			id: 'delete-beside',
			reason:
				'a plain delete facing a widget or a decoration answers by its policy before any byte rule; in reading mode it only enters a widget',
			claims: handleDeleteBeside
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
		{
			id: 'marker-completion',
			reason: 'the container re-emits this space itself, so writing it here would double it',
			claims: handleMarkerCompletion
		}
	];

	function handleKeydown(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		for (const arm of arms) {
			if (arm.claims(e, caretOffset)) return arm.cut !== true;
		}
		return false;
	}

	/** The kind's registered policy, unless this block draws the widget on its own terms. */
	function widgetPolicy(widget: InlineNode | WidgetAtCursor): EdgePolicy | undefined {
		return (
			deps.widgetEdgePolicy?.(widget) ?? getInlineWidgetEditing(widget.kind, deps.reading.grammar)
		);
	}

	function inlinesOf(node: NodeView): InlineNode[] {
		return resolvedInlineContent(node, deps.reading);
	}

	function display(): string {
		return trimTrailingLineEnding(deps.node.raw);
	}

	/** One rewrite of the displayed text a key makes, one CST commit, its bytes already where the
	 *  key put them. */
	function writeDisplay(text: string, caretAfter: number, source: string): void {
		void deps.writeText({
			text,
			caretAfter,
			intent: 'typed',
			history: 'join-typing',
			mode: 'authored',
			source,
			inPlace: true
		});
	}

	/** `span` replaced by `insert` through the in-leaf range replace, the store read at the key. */
	function rangeEdit(span: DeleteSpan, insert: string): Pick<TextWrite, 'text' | 'caretAfter'> {
		return rangeWrite(deps.node, replaceRangeInLeaf(deps.node, span, insert, deps.storedAs()));
	}

	function editDisplay(start: number, end: number, insert: string, source = 'island'): void {
		void deps.writeText({
			...rangeEdit({ start, end }, insert),
			intent: 'typed',
			history: 'join-typing',
			mode: 'authored',
			source
		});
	}

	/** The selected range, or null at a plain caret; every branch reads it here. Empty when both ends
	 *  clamp into the marker prefix, so a branch that writes bytes checks `end > start` first. */
	function heldRange(): { start: number; end: number } | null {
		return deps.getRawSelection();
	}

	// ── The shared helpers the branches below use ────────────────────────────

	/** What the construct-edge rule (live-mode.md § 4.4) does with a destructive key here, or null
	 *  where the block draws its markers and the byte beside the caret is one the user can see. */
	function edgeDeletionAt(
		el: HTMLElement,
		caret: number,
		direction: DeleteDirection
	): EdgeDeletion | null {
		const screen = hidingScreenOf(el);
		if (!screen) return null;
		return resolveEdgeDeletion({
			display: display(),
			asWritten: (text) => withOwnEnding(deps.node, text),
			content: getContentRange(deps.node),
			caret,
			direction,
			screen,
			inlines: inlinesOf(deps.node),
			store: deps.storedAs()
		});
	}

	/** A keypress with no safe rewrite writes nothing: the browser's version would show the
	 *  delimiters the rule was hiding. */
	function applyEdgeDeletion(deletion: EdgeDeletion, caret: number): void {
		if ('swallow' in deletion) return;
		// A letter taken back from Edit link's caret leaves the caret inside the URL still; the
		// write ends every record, so it is opened again where the cut left the caret.
		const tookOnlyBefore = deletion.caret + display().length - deletion.raw.length === caret;
		const stillInside = deps.insideCloser().at() === caret && tookOnlyBefore;
		writeDisplay(deletion.raw, deletion.caret, 'construct-delete');
		if (stillInside) deps.insideCloser().open(deletion.caret);
		// Pended after the write, since the write clears pending marks; the caret has not moved, so
		// the format waits for the next insertion (live-mode.md § 4.4).
		for (const kind of deletion.unwrappedMarks) deps.pendingMarks.toggle(kind);
	}

	/** A printable byte the browser would drop at an element-level caret: over a range through the
	 *  join rules, at a caret as an insertion the write places like any other. */
	function writeTypedByte(caretOffset: number, typed: string, source: string): void {
		const range = heldRange();
		if (range && range.end > range.start) editDisplay(range.start, range.end, typed, source);
		else editDisplay(caretOffset, caretOffset, typed, source);
	}

	// ── CST inline widget ────────────────────────────────────────────────────

	function handleCstWidget(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		if (deps.isRevealing()) return false;
		if (caretOffset === null) return false;
		const arrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
		if (!arrow && !isPlainTypingKey(e)) return false;
		const node = deps.node;
		// ArrowRight enters the widget after the caret, every other key the one before, so a caret
		// between two adjacent widgets enters the one the key is aimed at.
		const direction = e.key === 'ArrowRight' ? 'forward' : 'backward';
		const widgetAt = widgetAtCursor(caretOffset, widgetsIn(node, deps.reading), direction);
		if (!widgetAt) return false;
		// Past the early return: every keystroke in every prose block reaches the line above, so
		// the work below stays off that path.
		const range = heldRange();

		// A modifier makes an arrow a word or line step, and a selected range is an edit of that
		// range, not an entry into a construct.
		const plainArrow = isBareKey(e) && !range;
		const enterFromRight = plainArrow && widgetAt.atRight && e.key === 'ArrowLeft';
		const enterFromLeft = plainArrow && !widgetAt.atRight && e.key === 'ArrowRight';
		if (enterFromRight || enterFromLeft) {
			e.preventDefault();
			takeOrEnterWidget(widgetAt, false);
			return true;
		}
		// Chromium inserts into a text node natively, but drops printable keys at
		// element-level positions adjacent to a contenteditable=false widget.
		const el = deps.getEl();
		if (el && !caretIsInTextContent(el) && isPlainTypingKey(e) && !deps.isReading()) {
			e.preventDefault();
			deps.setSnapTarget(null);
			writeTypedByte(caretOffset, e.key, 'widget');
			return true;
		}
		return false;
	}

	/** A key aimed at the widget beside the caret: a delete takes an atomic one whole, and any other
	 *  key or kind enters it (`onEdge: 'select'`, or the source a kind shows instead). */
	function takeOrEnterWidget(widget: WidgetAtCursor, destructive: boolean): void {
		deps.setSnapTarget(null);
		if (destructive && widgetPolicy(widget)?.deleteGranularity === 'atomic' && !deps.isReading()) {
			editDisplay(widget.start, widget.end, '', 'widget');
			return;
		}
		deps.enterWidget(widget, widget.atRight);
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
		const range = document.createRange();
		range.selectNode(el);
		deps.caretWriter.selectDomRange(range);
	}

	function handleIsland(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		// A collapsed delete is the `delete-beside` arm's; this one takes a held range's delete.
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
			if (!selection) return false;
			const selected = islands.find(
				(i) =>
					islandPolicy(i).deleteGranularity === 'select-then-delete' &&
					i.start === selection.start &&
					i.end === selection.end
			);
			if (!selected) return false;
			e.preventDefault();
			editDisplay(selected.start, selected.end, '');
			return true;
		}

		// Some browsers drop printable keys at an element-level caret beside a non-editable widget.
		// Chromium types them, so a unit test, not e2e, covers this branch.
		if (caretOffset !== null && !caretIsInTextContent(el)) {
			e.preventDefault();
			writeTypedByte(caretOffset, e.key, 'island');
			return true;
		}
		return false;
	}

	/** The decorations a delete at a caret here can face: none in reading mode, which writes nothing
	 *  and selects no decoration, or in a block without any. */
	function facedIslands(el: HTMLElement): readonly IslandSpan[] {
		return deps.isReading() || !deps.hasIslands() ? [] : islandsInDom(el);
	}

	/** The widget or replace decoration a delete facing `direction` meets at `caret`, the widget
	 *  first; null with neither. */
	function facedBy(
		caret: number,
		direction: DeleteDirection,
		islands: readonly IslandSpan[]
	): { widget: WidgetAtCursor } | { island: IslandSpan } | null {
		const backward = direction === 'backward';
		const widget = widgetAtCursor(caret, widgetsIn(deps.node, deps.reading), direction);
		if (widget && widget.atRight === backward) return { widget };
		const island = islands.find(
			(i) =>
				islandPolicy(i).deleteGranularity === 'select-then-delete' &&
				(backward ? i.end === caret : i.start === caret)
		);
		return island ? { island } : null;
	}

	function takeFaced(faced: { widget: WidgetAtCursor } | { island: IslandSpan }): void {
		if ('widget' in faced) takeOrEnterWidget(faced.widget, true);
		else selectIslandWhole(faced.island.el);
	}

	function deleteBeside(caret: number, direction: DeleteDirection): boolean {
		const el = deps.getEl();
		if (!el || deps.isRevealing()) return false;
		const faced = facedBy(caret, direction, facedIslands(el));
		if (faced) takeFaced(faced);
		return faced !== null;
	}

	/** A one-character delete at a widget decoration, which stands for no bytes, takes what is
	 *  beside it, as if the decoration were not there; false at the block's edge. */
	function deletePastIsland(el: HTMLElement, caret: number, intent: DeleteIntent): boolean {
		const landable = landableRawBounds(el);
		if (facesEdge(landable, caret, intent.direction)) return false;
		// This branch outranks the construct-edge rule beside a hidden run, so it asks that rule.
		if (!hiddenRunDelete(el, caret, intent)) void deleteSpan(el, caret, intent, landable);
		return true;
	}

	/** A plain collapsed delete: what it faces beside the caret, else the byte past a widget
	 *  decoration at the caret, which the browser's own delete would not take. */
	function handleDeleteBeside(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		if (caretOffset === null || !isBareKey(e)) return false;
		if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
		const el = deps.getEl();
		if (!el || deps.isRevealing()) return false;
		const intent = keyIntent(e);
		const islands = facedIslands(el);
		const faced = facedBy(caretOffset, intent.direction, islands);
		const pastIsland = islands.some((i) => i.start === i.end && i.start === caretOffset);
		// Read last, off the common path: a range is an edit of the range, not of what is beside it.
		if ((!faced && !pastIsland) || heldRange()) return false;
		if (faced) takeFaced(faced);
		else if (!deletePastIsland(el, caretOffset, intent)) return false;
		e.preventDefault();
		return true;
	}

	// ── Spans an arrow crosses whole ─────────────────────────────────────────

	/** Whether `offset` sits against or inside `span` on the side `direction` names; a zero-width
	 *  span holds no offset, since the caret crosses onto the real byte beside it. */
	function sideHolds(span: { start: number; end: number }, offset: number, forward: boolean) {
		return forward
			? span.start <= offset && offset < span.end
			: span.start < offset && offset <= span.end;
	}

	const inlineUnits: CaretUnitSource = {
		beside(offset, direction, extending) {
			// A shown source is editable text again, which the browser's arrows walk.
			if (deps.isRevealing()) return null;
			const forward = direction === 'forward';
			for (const widget of widgetsIn(deps.node, deps.reading)) {
				if (!sideHolds(widget, offset, forward)) continue;
				// A plain arrow enters a widget that selects or shows its source, in the arm below.
				const crosses = extending || widgetPolicy(widget)?.onEdge === 'step-over';
				return crosses ? { start: widget.start, end: widget.end } : null;
			}
			if (!deps.hasIslands()) return null;
			const el = deps.getEl();
			const island = el && islandsInDom(el).find((i) => sideHolds(i, offset, forward));
			return island ? { start: island.start, end: island.end } : null;
		},
		crossed: () => deps.setSnapTarget(null)
	};

	// ── Container marker prefix overlap ────────────────────────────────────────

	// A selection reaching into the contenteditable="false" marker prefix blocks the browser's
	// Backspace and Delete silently, with no beforeinput, so delete through the CST instead.
	function handleAmbient(e: KeyboardEvent): boolean {
		if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
		const range = heldRange();
		if (!range) return false;
		const el = deps.getEl();
		if (!el) return false;
		const ambient = markerPrefixOf(el);
		const live = readNativeSelection();
		const touchesAmbient =
			!!ambient &&
			!!live &&
			(ambient.contains(live.anchor.node) || ambient.contains(live.focus.node));
		if (!touchesAmbient) return false;
		e.preventDefault();
		// A selection holding only the marker prefix covers no content byte, so there is nothing
		// to delete and the press is consumed with no commit.
		if (range.end > range.start) {
			// Handled at keydown, so this branch asks the join rules itself, or a literal splice would
			// print the delimiter runs the cut stranded (`docs/design/live-mode.md` § 4.5).
			editDisplay(range.start, range.end, '', 'ambient-delete');
		}
		return true;
	}

	// ── Collapsed deletes ──────────────────────────────────────────────────────

	/** The construct-edge rule's answer beside a hidden run, written; false where it has none. */
	function hiddenRunDelete(el: HTMLElement, caret: number, intent: DeleteIntent): boolean {
		if (intent.unit !== 'character') return false;
		const deletion = edgeDeletionAt(el, caret, intent.direction);
		if (!deletion) return false;
		deps.setSnapTarget(null);
		applyEdgeDeletion(deletion, caret);
		return true;
	}

	/** Whether `caret` is the first or last offset the caret can sit at, on the side `direction`
	 *  faces; `landable` null is a block that draws its markers, every offset reachable. */
	function facesEdge(
		landable: DeleteSpan | null,
		caret: number,
		direction: DeleteDirection
	): boolean {
		const bounds = landable ?? { start: 0, end: display().length };
		return direction === 'backward' ? caret <= bounds.start : caret >= bounds.end;
	}

	function deleteAtCaret(caret: number, intent: DeleteIntent): DeleteAnswer {
		if (deleteBeside(caret, intent.direction)) return 'taken';
		const el = deps.getEl();
		if (!el || deps.isRevealing()) return 'declined';
		// At the first or last offset the caret can sit at the delete is the block's merge, never
		// the first visible character past a hidden run.
		const landable = landableRawBounds(el);
		if (facesEdge(landable, caret, intent.direction)) return 'at-edge';
		if (hiddenRunDelete(el, caret, intent)) return 'taken';
		return deleteSpan(el, caret, intent, landable) ? 'taken' : 'at-edge';
	}

	/** The delete rule's span through the in-leaf range replace, a word read as the screen shows it;
	 *  a cut leaving a heading only hidden markers empties it. False with nothing to take. */
	function deleteSpan(
		el: HTMLElement,
		caret: number,
		intent: DeleteIntent,
		landable: DeleteSpan | null
	): boolean {
		const text = display();
		const span = deleteExtent(intent, {
			text,
			caret,
			bounds: landable ?? { start: 0, end: text.length },
			lineEdge: (side) => lineEdgeOffset(el, caret, side, deps.caretWriter),
			visible: intent.unit === 'word' ? visibleWalkText(el) : undefined
		});
		if (!span) return false;
		deps.setSnapTarget(null);
		const written = rangeEdit(span, '');
		const kept = keptBlockText(editedBlock(el, text, span, written.text));
		if (kept !== written.text) writeDisplay(kept, 0, 'delete');
		else
			void deps.writeText({
				...written,
				intent: 'typed',
				history: 'join-typing',
				mode: 'authored',
				source: 'delete'
			});
		return true;
	}

	/** The block as `keptBlockText` reads it once `span` is cut from `text`, the parts the input
	 *  read-back takes from the DOM. */
	function editedBlock(
		el: HTMLElement,
		text: string,
		span: DeleteSpan,
		after: string
	): EditedBlock {
		const range = getContentRange(deps.node);
		const hidesPrefix = range.start > 0 && hidesBlockPrefix(el);
		const from = hidesPrefix ? range.start : 0;
		const to = text.length - structuralSuffix(deps.node).length;
		const clip = (at: number) => Math.min(Math.max(at, from), to);
		const content = text.slice(from, clip(span.start)) + text.slice(clip(span.end), to);
		return { text: after, content, hidesPrefix, wasBlank: isBlankText(text.slice(from, to)) };
	}

	// ── Container marker completion ────────────────────────────────────────────

	/** A bare space at a child's content start, while its container's marker lacks its space, is
	 *  the marker's, once: written into the container's line, or left for an empty line's text. */
	function handleMarkerCompletion(e: KeyboardEvent, caretOffset: RawOffset | null): boolean {
		const bareSpace = e.key === ' ' && !e.shiftKey && !hasModifier(e);
		if (!bareSpace || caretOffset === null || heldRange()) return false;
		const { node, containerParent, index } = deps;
		const claim = markerCompletion.claimSpace(node, containerParent, index, caretOffset);
		if (claim === null) return false;
		e.preventDefault();
		if (claim === 'bare-marker') deps.completeMarker();
		return true;
	}

	function typeBeforeClosingWidget(caret: number, typed: string): boolean {
		if (deps.isRevealing() || deps.isReading() || heldRange()) return false;
		const end = getContentRange(deps.node).end;
		const widgets = widgetsIn(deps.node, deps.reading);
		if (!widgets.some((widget) => widget.start === caret && widget.end === end)) return false;
		writeTypedByte(caret, typed, 'closing-widget');
		return true;
	}

	function keyIntent(e: KeyboardEvent): DeleteIntent {
		return { unit: 'character', direction: e.key === 'Backspace' ? 'backward' : 'forward' };
	}

	return { handleKeydown, arms, inlineUnits, typeBeforeClosingWidget, deleteAtCaret, deleteBeside };
}
