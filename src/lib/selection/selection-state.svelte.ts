/**
 * Reactive state for the selections the editor owns: a cross-block range, a gap caret
 * (`gap-caret.ts`), or an inline widget selected whole. At most one is live, since every mutator
 * writes all three through one private writer; all are null while the browser's own selection
 * rules. Transitions: `docs/design/editor.md` § Cross-block selection.
 */

import type { DocumentView } from '../core/node-views';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import type { GapCaretPosition } from './gap-caret';
import type {
	SelectedWidgetRange,
	SelectionEndpoint,
	SelectionPoint,
	WidgetTarget
} from './primitives';
import { isWholeBlockEndpoint, normalize } from './primitives';
import {
	cellEndpointDeepPath,
	normalizeTableEndpoint,
	snapCrossBlockTableEndpoints,
	wholeTableEndpoint
} from './table-endpoint-snap';
import { normalizeCharEndpoint } from './char-endpoint-snap';
import { comparePaths, pathsEqual } from './path-math';
import { displayLength } from '../core/lines';
import { assertInvariant } from '../assert';
import { checkCrossBlockEndpointCoordinates } from '../invariants/selection-endpoints';
import { isWholeBlockUnit } from '../schema/whole-block-unit';

// ── Public factory ──────────────────────────────────────────────────────────

export interface SelectionStateOptions {
	/** Fires after any mutation, or once at the end of a {@link SelectionState.batch} that held
	 *  one; `placementOnly` says a caret placement was all the flush held. */
	onChange?: (change: { placementOnly: boolean }) => void;
	/** Document accessor. Absent in harnesses that only exercise cross-block semantics, where no
	 *  point is normalized and a table endpoint is stored as written. */
	getDoc?: () => DocumentView;
	/** The live span of the widget a selection holds, or null once none starts there. Absent, a
	 *  selected widget has no range and reports the offset it was entered at. */
	widgetSpan?: (target: WidgetTarget) => { start: number; end: number } | null;
}

export function createSelectionState(options?: SelectionStateOptions): SelectionState {
	return new SelectionStateImpl(options);
}

// ── Interface ───────────────────────────────────────────────────────────────

export type RestoreRoute = 'collapsed' | 'single-block' | 'whole-block' | 'custom';

export interface SelectionState {
	readonly anchor: SelectionPoint | null;
	readonly focus: SelectionPoint | null;
	readonly isCrossBlock: boolean;
	/**
	 * True when the overlay paints instead of the native browser highlight: every
	 * cross-block selection, plus a rectangle of two or more cells inside one table.
	 */
	readonly isCustomRendered: boolean;
	readonly start: SelectionPoint | null;
	readonly end: SelectionPoint | null;
	readonly selectAllCount: number;
	/** The third mode: a collapsed caret in a between-blocks boundary (`gap-caret.ts`). */
	readonly gapCaret: GapCaretPosition | null;
	/** One block taken whole as the range (a drag inside a leaf with no text, such as an equation),
	 *  which the same-path check would otherwise refuse; the overlay paints it as a unit. */
	readonly wholeUnitPath: number[] | null;
	/** The inline widget selected whole, or null. Copied out, like `gapCaret`. */
	readonly widget: WidgetTarget | null;
	/** The selected widget's span read from the live document, since its own commits move its
	 *  end; null with no widget selected, or once no widget starts at its byte. */
	widgetRange(): SelectedWidgetRange | null;
	/** The caret a selected widget stands for: the edge of its span it was entered from. */
	widgetCaret(): SelectionPoint | null;
	/** The selected widget when it sits in the block at `path`, or null. */
	widgetIn(path: readonly number[]): WidgetTarget | null;

	// Every mutator below is silent when it changes nothing: a reset that clears what is
	// already clear must not make a subscriber re-read an unmoved selection.
	enterCrossBlock(anchor: SelectionEndpoint, focus: SelectionEndpoint): void;
	extendFocus(point: SelectionEndpoint): void;
	collapse(): void;
	clear(): void;
	/** Drops whatever is live without notifying, for a document swap: it addresses the outgoing
	 *  tree, and the restore that follows announces the new selection. */
	dropForDocumentSwap(): void;
	setGapCaret(pos: GapCaretPosition): void;
	clearGapCaret(): void;
	/** Selects a widget whole and announces it. A widget ending by itself announces nothing: the
	 *  caret that replaces it announces itself. */
	selectWidget(target: WidgetTarget): void;
	/** Moves a selected widget by `delta` bytes when it sits in `path` at or past `editEnd`: an
	 *  edit to another widget earlier in the block moved its bytes, not its identity. Silent. */
	followWidgetEdit(path: readonly number[], editEnd: number, delta: number): void;
	/** Ends a selected widget as `clear` does; with none selected, ends nothing else. */
	clearWidget(): void;
	incrementSelectAllCount(): void;
	resetSelectAllCount(): void;

	/** Notifies for a change no mutator above sees (a caret the editor placed, a restore, a source
	 *  swap), since subscribers read back through `getSelection()`. Coalesces inside a batch. */
	announceSelection(): void;

	/**
	 * Notifies for a caret placement. The flush says whether a placement was all it held, so a
	 * listener can drop one that put the caret where it already was.
	 */
	announcePlacement(): void;

	/** Holds the change notification until `mutate` returns, then fires once; nests, and flushes on
	 *  a throw. Wrap a state write and its caret placement so no notify lands between the two. */
	batch(mutate: () => void): void;

	/** Classifies a pair `resolveSelectionPoint` returned, for a DOM restore, touching no state. A
	 *  same-path pair over a block with no character position is that block held whole. */
	restoreRoute(anchor: SelectionPoint, focus: SelectionPoint): RestoreRoute;
	/** Where a caret lands for `point`: a cell endpoint in its cell's `[table, row, col]` leaf at
	 *  offset 0, any other point as itself. Every mount and caret placement goes through here. */
	cellLandingFor(point: SelectionPoint): SelectionPoint;
}

// ── Implementation ──────────────────────────────────────────────────────────

// Normalization flags both corners of a rectangle, so either flag names the pair's space.
function isCellPair(a: SelectionPoint, f: SelectionPoint): boolean {
	return a.cellCoordinate === true || f.cellCoordinate === true;
}

/** The one live editor-owned selection a write leaves behind; null ends all of them. */
type Claim =
	| { range: { anchor: SelectionPoint; focus: SelectionPoint; wholeUnit: number[] | null } }
	| { gap: GapCaretPosition }
	| { widget: WidgetTarget }
	| null;

class SelectionStateImpl implements SelectionState {
	// Separate cells, so a reader of one kind (the image overlay reads the widget) doesn't re-run
	// on every write of another, such as each move of a drag.
	#anchor: SelectionPoint | null = $state(null);
	#focus: SelectionPoint | null = $state(null);
	#gapCaret: GapCaretPosition | null = $state(null);
	#wholeUnit: number[] | null = $state(null);
	#widget: WidgetTarget | null = $state(null);
	#selectAllCount: number = $state(0);
	#onChange?: (change: { placementOnly: boolean }) => void;
	#getDoc?: () => DocumentView;
	#widgetSpan?: (target: WidgetTarget) => { start: number; end: number } | null;
	#batchDepth = 0;
	#notifyPending = false;
	// False once a notification that is not a caret placement joins the pending flush.
	#placementOnly = true;

	constructor(options?: SelectionStateOptions) {
		this.#onChange = options?.onChange;
		this.#getDoc = options?.getDoc;
		this.#widgetSpan = options?.widgetSpan;
	}

	// The only writer of the five cells, so no mutator can set one kind without ending the others.
	#claim(next: Claim): void {
		const range = next && 'range' in next ? next.range : null;
		this.#anchor = range?.anchor ?? null;
		this.#focus = range?.focus ?? null;
		this.#wholeUnit = range?.wholeUnit ?? null;
		this.#gapCaret = next && 'gap' in next ? next.gap : null;
		this.#widget = next && 'widget' in next ? next.widget : null;
	}

	batch(mutate: () => void): void {
		this.#batchDepth += 1;
		try {
			mutate();
		} finally {
			this.#batchDepth -= 1;
			if (this.#batchDepth === 0 && this.#notifyPending) {
				this.#notifyPending = false;
				this.#flush();
			}
		}
	}

	#notify(fromPlacement = false): void {
		if (!fromPlacement) this.#placementOnly = false;
		if (this.#batchDepth > 0) {
			this.#notifyPending = true;
			return;
		}
		this.#flush();
	}

	#flush(): void {
		const placementOnly = this.#placementOnly;
		this.#placementOnly = true;
		this.#onChange?.({ placementOnly });
	}

	get anchor(): SelectionPoint | null {
		return this.#anchor;
	}

	get focus(): SelectionPoint | null {
		return this.#focus;
	}

	// Copied out, as `setGapCaret` copies in: a consumer that mutates what it reads back
	// would otherwise write state without notifying anyone.
	get gapCaret(): GapCaretPosition | null {
		const gap = this.#gapCaret;
		return gap && { parentPath: gap.parentPath.slice(), index: gap.index };
	}

	get isCrossBlock(): boolean {
		return this.#anchor !== null && this.#focus !== null;
	}

	get wholeUnitPath(): number[] | null {
		return this.#wholeUnit?.slice() ?? null;
	}

	get widget(): WidgetTarget | null {
		const widget = this.#widget;
		return widget && copyWidget(widget);
	}

	widgetRange(): SelectedWidgetRange | null {
		const widget = this.#widget;
		const span = widget && this.#widgetSpan?.(copyWidget(widget));
		return widget && span
			? { path: widget.paragraphPath.slice(), start: span.start, end: span.end }
			: null;
	}

	widgetCaret(): SelectionPoint | null {
		const widget = this.#widget;
		if (!widget) return null;
		const live = this.widgetRange();
		const fromStart = widget.preSelectOffset === widget.sourceStart;
		const offset = live ? (fromStart ? live.start : live.end) : widget.preSelectOffset;
		return { path: widget.paragraphPath.slice(), offset };
	}

	widgetIn(path: readonly number[]): WidgetTarget | null {
		const widget = this.#widget;
		return widget && pathsEqual(widget.paragraphPath, path) ? copyWidget(widget) : null;
	}

	get isCustomRendered(): boolean {
		const anchor = this.#anchor;
		const focus = this.#focus;
		if (!anchor || !focus) return false;
		if (this.#wholeUnit) return true;
		if (!pathsEqual(anchor.path, focus.path)) return true;
		// A same-path pair is one cell (the browser's) or a rectangle of cells (the overlay's).
		return anchor.offset !== focus.offset && isCellPair(anchor, focus);
	}

	get start(): SelectionPoint | null {
		return this.#normalizedSnapped()?.start ?? null;
	}

	get end(): SelectionPoint | null {
		return this.#normalizedSnapped()?.end ?? null;
	}

	// Cross-block table endpoints snap to whole rows so highlight, copy, and delete agree
	// (table-endpoint-snap.ts). Harnesses without getDoc never carry a table endpoint.
	#normalizedSnapped(): { start: SelectionPoint; end: SelectionPoint } | null {
		if (!this.#anchor || !this.#focus) return null;
		const range = normalize({ anchor: this.#anchor, focus: this.#focus });
		const getDoc = this.#getDoc;
		if (!getDoc) return range;
		return snapCrossBlockTableEndpoints(getDoc(), range.start, range.end);
	}

	get selectAllCount(): number {
		return this.#selectAllCount;
	}

	enterCrossBlock(anchor: SelectionEndpoint, focus: SelectionEndpoint): void {
		// Both ends on one block with no text: the block is the range, stored as its full span
		// (a table's first and last cell) and flagged whole, as a same-path pair is refused below.
		if (
			isWholeBlockEndpoint(anchor) &&
			isWholeBlockEndpoint(focus) &&
			pathsEqual(anchor.path, focus.path)
		) {
			const path = anchor.path.slice();
			const doc = this.#getDoc?.();
			const a = (doc && wholeTableEndpoint(doc, path, 'start')) ?? { path, offset: 0 };
			const f = (doc && wholeTableEndpoint(doc, path, 'end')) ?? {
				path: path.slice(),
				offset: this.#byteLengthAt(path)
			};
			this.#assertEndpointCoordinates(a, f);
			this.#claim({ range: { anchor: a, focus: f, wholeUnit: path.slice() } });
			this.#notify();
			return;
		}
		const a = this.#normalizePoint(anchor, focus.path);
		const f = this.#normalizePoint(focus, anchor.path);
		// A same-path text pair is a single-block range the browser owns, refused here where every
		// entry path passes; a cell rectangle and the keyboard's equal-offset first pair are kept.
		if (this.#isSamePathProseRange(a, f)) {
			this.#claim(null);
		} else {
			this.#assertEndpointCoordinates(a, f);
			this.#claim({ range: { anchor: a, focus: f, wholeUnit: null } });
		}
		this.#notify();
	}

	extendFocus(point: SelectionEndpoint): void {
		if (!this.#anchor) {
			throw new Error('SelectionState.extendFocus called without an anchor');
		}
		// Leaving a whole-block range: its anchor is the block as a whole again, so the side it
		// means (start below the new focus, end above it) is resolved afresh rather than kept at 0.
		const anchor = this.#wholeUnit
			? this.#normalizePoint({ path: this.#wholeUnit, wholeBlock: true }, point.path)
			: this.#anchor;
		const f = this.#normalizePoint(point, anchor.path);
		// A focus back on the anchor's text leaf shrinks to a single-block range, even at the
		// anchor's own offset: `extendFocus` never starts a pair, so landing there is a collapse.
		if (pathsEqual(anchor.path, f.path) && !isCellPair(anchor, f)) {
			this.#claim(null);
		} else {
			this.#assertEndpointCoordinates(anchor, f);
			this.#claim({ range: { anchor, focus: f, wholeUnit: null } });
		}
		this.#notify();
	}

	#byteLengthAt(path: number[]): number {
		const doc = this.#getDoc?.();
		const node = doc ? nodeAt(doc, path) : null;
		return node && 'raw' in node ? displayLength(node.raw) : 0;
	}

	// The endpoint coordinate check backs up `#normalizePoint` at every write of anchor and focus.
	#assertEndpointCoordinates(anchor: SelectionPoint, focus: SelectionPoint): void {
		const getDoc = this.#getDoc;
		if (!getDoc) return;
		assertInvariant('cross-block-endpoint-coordinates', () =>
			checkCrossBlockEndpointCoordinates(getDoc(), anchor, focus)
		);
	}

	// Same text leaf, distinct offsets: the shape that must never enter cross-block state.
	// Equal-offset pairs are excluded so the keyboard's starting pair survives to its extend.
	#isSamePathProseRange(a: SelectionPoint, f: SelectionPoint): boolean {
		return pathsEqual(a.path, f.path) && !isCellPair(a, f) && a.offset !== f.offset;
	}

	// The one place every entry path normalizes: a table endpoint becomes a flagged cell index and
	// a character offset is clamped into its block. Without a document, points pass through.
	#normalizePoint(point: SelectionEndpoint, otherPath: readonly number[]): SelectionPoint {
		const getDoc = this.#getDoc;
		if (!getDoc) {
			return isWholeBlockEndpoint(point) ? { path: point.path.slice(), offset: 0 } : point;
		}
		const doc = getDoc();
		if (isWholeBlockEndpoint(point)) {
			const side = comparePaths(point.path, otherPath) > 0 ? 'end' : 'start';
			return (
				wholeTableEndpoint(doc, point.path, side) ?? normalizeCharEndpoint(doc, point, otherPath)
			);
		}
		if (point.cellCoordinate) return point;
		const snapped = normalizeTableEndpoint(doc, point.path, point.offset);
		return snapped.cellCoordinate ? snapped : normalizeCharEndpoint(doc, snapped, otherPath);
	}

	collapse(): void {
		const announce = this.#hasCaretClaim();
		this.#claim(null);
		if (announce) this.#notify();
	}

	dropForDocumentSwap(): void {
		this.#claim(null);
	}

	clear(): void {
		const announce = this.#hasCaretClaim() || this.#selectAllCount !== 0;
		this.#claim(null);
		this.#selectAllCount = 0;
		if (announce) this.#notify();
	}

	// A range or a gap caret: what the clears announce ending. A widget is left out, since the
	// caret that replaces it announces itself.
	#hasCaretClaim(): boolean {
		return this.#anchor !== null || this.#focus !== null || this.#gapCaret !== null;
	}

	// The copy keeps a caller's own position object from writing through.
	setGapCaret(pos: GapCaretPosition): void {
		this.#claim({ gap: { parentPath: pos.parentPath.slice(), index: pos.index } });
		this.#notify();
	}

	clearGapCaret(): void {
		if (this.#gapCaret === null) return;
		this.#claim(null);
		this.#notify();
	}

	selectWidget(target: WidgetTarget): void {
		this.#claim({ widget: copyWidget(target) });
		this.#notify();
	}

	followWidgetEdit(path: readonly number[], editEnd: number, delta: number): void {
		const widget = this.#widget;
		if (!widget || widget.sourceStart < editEnd || !pathsEqual(widget.paragraphPath, path)) return;
		this.#claim({
			widget: {
				paragraphPath: widget.paragraphPath.slice(),
				sourceStart: widget.sourceStart + delta,
				preSelectOffset: widget.preSelectOffset + delta
			}
		});
	}

	clearWidget(): void {
		if (this.#widget !== null) this.clear();
	}

	incrementSelectAllCount(): void {
		this.#selectAllCount += 1;
		this.#notify();
	}

	restoreRoute(anchor: SelectionPoint, focus: SelectionPoint): RestoreRoute {
		if (!pathsEqual(anchor.path, focus.path)) return 'custom';
		if (anchor.offset === focus.offset) return 'collapsed';
		if (isCellPair(anchor, focus)) return 'custom';
		const doc = this.#getDoc?.();
		const node = doc ? nodeAt(doc, anchor.path) : null;
		return node && isBlockNode(node) && isWholeBlockUnit(node) ? 'whole-block' : 'single-block';
	}

	cellLandingFor(point: SelectionPoint): SelectionPoint {
		const getDoc = this.#getDoc;
		if (!getDoc) return point;
		const deepPath = cellEndpointDeepPath(getDoc(), point);
		return deepPath ? { path: deepPath, offset: 0 } : point;
	}

	resetSelectAllCount(): void {
		if (this.#selectAllCount === 0) return;
		this.#selectAllCount = 0;
		this.#notify();
	}

	announceSelection(): void {
		this.#notify();
	}

	announcePlacement(): void {
		this.#notify(true);
	}
}

// Copied at both ends, as the gap caret is: neither a caller's object nor a reader's copy can
// write the stored widget without a notification.
function copyWidget(target: WidgetTarget): WidgetTarget {
	return {
		paragraphPath: target.paragraphPath.slice(),
		sourceStart: target.sourceStart,
		preSelectOffset: target.preSelectOffset
	};
}
