/**
 * Reactive state for the editor-owned selection modes: a cross-block `anchor`/`focus` pair,
 * and the collapsed `gapCaret` (`gap-caret.ts`). Both are null in single-block mode, where the
 * native browser selection rules, and the two are mutually exclusive here rather than at any
 * call site. Transitions: `docs/design/editor.md` § Cross-block selection.
 */

import type { DocumentView } from '../core/node-views';
import { nodeAt } from '../tree-operations/node-ops';
import type { GapCaretPosition } from './gap-caret';
import type { SelectionEndpoint, SelectionPoint } from './primitives';
import { isWholeBlockEndpoint, normalize } from './primitives';
import {
	cellEndpointDeepPath,
	normalizeTableEndpoint,
	snapCrossBlockTableEndpoints
} from './table-endpoint-snap';
import { normalizeCharEndpoint } from './char-endpoint-snap';
import { pathsEqual } from './path-math';
import { assertInvariant } from '../invariants/assert';
import { checkCrossBlockEndpointCoordinates } from '../invariants/selection-endpoints';

// ── Public factory ──────────────────────────────────────────────────────────

export interface SelectionStateOptions {
	/**
	 * Fires after any mutation, or once at the end of a {@link SelectionState.batch} that
	 * contained one. No payload: subscribers read back via `editor.getSelection()`.
	 */
	onChange?: () => void;
	/**
	 * Document accessor. Absent in harnesses that only exercise cross-block semantics;
	 * without it `isCustomRendered` cannot see intra-table rects and mirrors `isCrossBlock`.
	 */
	getDoc?: () => DocumentView;
}

export function createSelectionState(options?: SelectionStateOptions): SelectionState {
	return new SelectionStateImpl(options);
}

// ── Interface ───────────────────────────────────────────────────────────────

export interface SelectionState {
	readonly anchor: SelectionPoint | null;
	readonly focus: SelectionPoint | null;
	readonly isCrossBlock: boolean;
	/**
	 * True when the overlay paints instead of the native browser highlight: every
	 * cross-block selection, plus same-path multi-offset selections inside tables.
	 */
	readonly isCustomRendered: boolean;
	readonly start: SelectionPoint | null;
	readonly end: SelectionPoint | null;
	readonly selectAllCount: number;
	/** The third mode: a collapsed caret in a between-blocks boundary (`gap-caret.ts`). */
	readonly gapCaret: GapCaretPosition | null;

	// Every mutator below is silent when it changes nothing: a preamble that clears what is
	// already clear must not wake a subscriber into re-reading an unmoved selection.
	enterCrossBlock(anchor: SelectionEndpoint, focus: SelectionEndpoint): void;
	extendFocus(point: SelectionEndpoint): void;
	collapse(): void;
	clear(): void;
	setGapCaret(pos: GapCaretPosition): void;
	clearGapCaret(): void;
	incrementSelectAllCount(): void;
	resetSelectAllCount(): void;

	/**
	 * Fire the channel for a selection this state cannot see. Subscribers read the editor
	 * back through `getSelection()`, which also answers for a NATIVE caret the restore road
	 * lands and for a document a `source` swap replaced under it — neither of which moves a
	 * field the mutators above guard on. Coalesces inside a {@link SelectionState.batch}.
	 */
	announceSelection(): void;

	/**
	 * Hold change notification until `mutate` returns, then fire once if anything mutated.
	 * Nests; flushes even when the body throws. An entry path that writes state AND lands a
	 * caret must wrap both: subscribers read the editor back on notify, so a notify between
	 * the two reports a caret the DOM half has not moved yet.
	 */
	batch(mutate: () => void): void;

	/**
	 * Classify an anchor/focus pair for DOM restore WITHOUT mutating state, so no phantom
	 * cross-block onChange fires. Same-path prose is 'single-block' (native highlight); a
	 * cross-block or intra-table cell rect is 'custom' (overlay).
	 */
	restoreRoute(
		anchor: SelectionPoint,
		focus: SelectionPoint
	): 'collapsed' | 'single-block' | 'custom';
	/**
	 * Where a caret lands for `point`: an endpoint inside a table addresses the table block by
	 * cell INDEX, so its landing is the cell's own deep `[table,row,col]` leaf at offset 0.
	 * Any other point lands as itself. Every reveal and every park goes through here, so no
	 * caller can seat a cell index as a char offset on the table wrapper.
	 */
	cellLandingFor(point: SelectionPoint): SelectionPoint;
}

// ── Implementation ──────────────────────────────────────────────────────────

class SelectionStateImpl implements SelectionState {
	#anchor: SelectionPoint | null = $state(null);
	#focus: SelectionPoint | null = $state(null);
	#gapCaret: GapCaretPosition | null = $state(null);
	#selectAllCount: number = $state(0);
	#onChange?: () => void;
	#getDoc?: () => DocumentView;
	#batchDepth = 0;
	#notifyPending = false;

	constructor(options?: SelectionStateOptions) {
		this.#onChange = options?.onChange;
		this.#getDoc = options?.getDoc;
	}

	batch(mutate: () => void): void {
		this.#batchDepth += 1;
		try {
			mutate();
		} finally {
			this.#batchDepth -= 1;
			if (this.#batchDepth === 0 && this.#notifyPending) {
				this.#notifyPending = false;
				this.#onChange?.();
			}
		}
	}

	#notify(): void {
		if (this.#batchDepth > 0) {
			this.#notifyPending = true;
			return;
		}
		this.#onChange?.();
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

	get isCustomRendered(): boolean {
		const getDoc = this.#getDoc;
		if (!getDoc) return this.isCrossBlock;
		const anchor = this.#anchor;
		const focus = this.#focus;
		if (!anchor || !focus) return false;
		if (!pathsEqual(anchor.path, focus.path)) return true;
		if (anchor.offset === focus.offset) return false;
		const node = nodeAt(getDoc(), anchor.path);
		if (!node) return false;
		return node.kind === 'table';
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
		this.#gapCaret = null;
		const a = this.#normalizePoint(anchor, focus.path);
		const f = this.#normalizePoint(focus, anchor.path);
		// A same-path prose pair is a single-block range the browser owns; storing it mints an
		// INVISIBLE cross-block state. Refuse it here so no entry path can. Intra-table rects
		// share the table path but flag a cell coordinate, and the same-offset keyboard seed is
		// kept so its immediate `extendFocus` has an anchor.
		if (this.#isSamePathProseRange(a, f)) {
			this.#anchor = null;
			this.#focus = null;
		} else {
			this.#assertEndpointCoordinates(a, f);
			this.#anchor = a;
			this.#focus = f;
		}
		this.#notify();
	}

	extendFocus(point: SelectionEndpoint): void {
		if (!this.#anchor) {
			throw new Error('SelectionState.extendFocus called without an anchor');
		}
		this.#gapCaret = null;
		const f = this.#normalizePoint(point, this.#anchor.path);
		// A focus back on the anchor's prose leaf contracts to a single-block range. No
		// `offset !== offset` guard, unlike #isSamePathProseRange: extendFocus never seeds, so
		// landing exactly on the anchor offset is a collapse that must not be stored either.
		if (
			pathsEqual(this.#anchor.path, f.path) &&
			!this.#anchor.cellCoordinate &&
			!f.cellCoordinate
		) {
			this.#anchor = null;
			this.#focus = null;
		} else {
			this.#assertEndpointCoordinates(this.#anchor, f);
			this.#focus = f;
		}
		this.#notify();
	}

	// G1.29 at the storing seam: #normalizePoint is meant to make this unfireable, and did
	// not for a length-1 table path. Both entries carry it because both store an endpoint pair.
	#assertEndpointCoordinates(anchor: SelectionPoint, focus: SelectionPoint): void {
		const getDoc = this.#getDoc;
		if (!getDoc) return;
		assertInvariant('cross-block-endpoint-coordinates', () =>
			checkCrossBlockEndpointCoordinates(getDoc(), anchor, focus)
		);
	}

	// Same prose leaf, distinct offsets: the shape that must never enter cross-block state.
	// Equal-offset pairs are excluded so the keyboard entry seed survives to its extend.
	#isSamePathProseRange(a: SelectionPoint, f: SelectionPoint): boolean {
		return (
			pathsEqual(a.path, f.path) && !a.cellCoordinate && !f.cellCoordinate && a.offset !== f.offset
		);
	}

	// The funnel every entry path (keyboard, shift-click, drag, select-all, undo restore) goes
	// through: a table endpoint can never be stored as a deep cell path with a char offset, and a
	// char offset can never be stored outside the space its own block addresses (both funnels'
	// headers). Never normalize at a call site instead. Idempotent; without a doc nothing can be
	// measured, so points pass raw.
	#normalizePoint(point: SelectionEndpoint, otherPath: readonly number[]): SelectionPoint {
		const getDoc = this.#getDoc;
		if (!getDoc) {
			return isWholeBlockEndpoint(point) ? { path: point.path.slice(), offset: 0 } : point;
		}
		const doc = getDoc();
		if (isWholeBlockEndpoint(point)) return normalizeCharEndpoint(doc, point, otherPath);
		if (point.cellCoordinate) return point;
		const snapped = normalizeTableEndpoint(doc, point.path, point.offset);
		return snapped.cellCoordinate ? snapped : normalizeCharEndpoint(doc, snapped, otherPath);
	}

	collapse(): void {
		if (!this.#hasCaretClaim()) return;
		this.#anchor = null;
		this.#focus = null;
		this.#gapCaret = null;
		this.#notify();
	}

	clear(): void {
		if (!this.#hasCaretClaim() && this.#selectAllCount === 0) return;
		this.#anchor = null;
		this.#focus = null;
		this.#gapCaret = null;
		this.#selectAllCount = 0;
		this.#notify();
	}

	// Every field the two clears zero: a guard reading fewer of them would swallow the
	// notification for the ones it does not see.
	#hasCaretClaim(): boolean {
		return this.#anchor !== null || this.#focus !== null || this.#gapCaret !== null;
	}

	// The mutual exclusion's other half: a gap and a range are never live together, and the
	// copy is what keeps a caller's own position object from writing through.
	setGapCaret(pos: GapCaretPosition): void {
		this.#anchor = null;
		this.#focus = null;
		this.#gapCaret = { parentPath: pos.parentPath.slice(), index: pos.index };
		this.#notify();
	}

	clearGapCaret(): void {
		if (this.#gapCaret === null) return;
		this.#gapCaret = null;
		this.#notify();
	}

	incrementSelectAllCount(): void {
		this.#selectAllCount += 1;
		this.#notify();
	}

	restoreRoute(
		anchor: SelectionPoint,
		focus: SelectionPoint
	): 'collapsed' | 'single-block' | 'custom' {
		if (!pathsEqual(anchor.path, focus.path)) return 'custom';
		if (anchor.offset === focus.offset) return 'collapsed';
		// Same path, distinct offsets: a table cell rect (flagged endpoint, or a table node
		// under the shared path) paints via the overlay; prose is a native range.
		if (anchor.cellCoordinate || focus.cellCoordinate) return 'custom';
		const getDoc = this.#getDoc;
		if (!getDoc) return 'single-block';
		const node = nodeAt(getDoc(), anchor.path);
		return node?.kind === 'table' ? 'custom' : 'single-block';
	}

	cellLandingFor(point: SelectionPoint): SelectionPoint {
		const getDoc = this.#getDoc;
		if (!getDoc) return point;
		// Resolution is the door's, on the node kind: a context-established intra-table endpoint
		// is unflagged and still a cell index, and a non-table path answers null.
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
}
