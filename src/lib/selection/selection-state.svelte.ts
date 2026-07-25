/**
 * Reactive state for cross-block selection. `anchor` and `focus` are null in
 * single-block mode — the native browser selection handles
 * single-block editing. Transitions: `docs/design/editor.md` § Cross-block
 * selection.
 */

import type { DocumentView } from '../core/node-views';
import { nodeAt } from '../tree-operations/node-ops';
import type { SelectionPoint } from './primitives';
import { normalize } from './primitives';
import {
	cellEndpointDeepPath,
	normalizeTableEndpoint,
	snapCrossBlockTableEndpoints
} from './table-endpoint-snap';
import { pathsEqual } from './path-math';
import { assertInvariant } from '../invariants/assert';
import { checkCrossBlockEndpointCoordinates } from '../invariants/selection-endpoints';

// ── Public factory ──────────────────────────────────────────────────────────

export interface SelectionStateOptions {
	/**
	 * Fired after any state mutation. No payload — subscribers call
	 * `editor.getSelection()` to read the new value. Bridged onto the
	 * `selectionChange` event (reached via `getEvents()`) by Editor.svelte.
	 */
	onChange?: () => void;
	/**
	 * Document accessor. When present, `isCustomRendered` can detect
	 * intra-table multi-cell selections (same path, distinct cell offsets on
	 * a table node — endpoint normalization guarantees table selections
	 * address the wrapper, never a row/cell). Absent in test harnesses that
	 * only exercise cross-block semantics — `isCustomRendered` then mirrors
	 * `isCrossBlock`.
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
	 * True when the selection should be painted by the overlay rather than
	 * the native browser highlight. Includes every cross-block selection
	 * plus same-path multi-offset selections inside table containers.
	 */
	readonly isCustomRendered: boolean;
	readonly start: SelectionPoint | null;
	readonly end: SelectionPoint | null;
	readonly selectAllCount: number;

	enterCrossBlock(anchor: SelectionPoint, focus: SelectionPoint): void;
	extendFocus(point: SelectionPoint): void;
	collapse(): void;
	clear(): void;
	incrementSelectAllCount(): void;
	resetSelectAllCount(): void;

	/**
	 * Route an anchor/focus pair for DOM restore WITHOUT mutating state, so the
	 * caller classifies before it decides — no phantom cross-block onChange. A
	 * same-path prose range is 'single-block' (native browser highlight); a
	 * cross-block or intra-table cell rect is 'custom' (overlay); equal offsets
	 * are 'collapsed'.
	 */
	restoreRoute(
		anchor: SelectionPoint,
		focus: SelectionPoint
	): 'collapsed' | 'single-block' | 'custom';
	/** The deep `[table,row,col]` leaf path of a cell-coordinate point, else null. */
	cellDeepPath(point: SelectionPoint): number[] | null;
}

// ── Implementation ──────────────────────────────────────────────────────────

class SelectionStateImpl implements SelectionState {
	#anchor: SelectionPoint | null = $state(null);
	#focus: SelectionPoint | null = $state(null);
	#selectAllCount: number = $state(0);
	#onChange?: () => void;
	#getDoc?: () => DocumentView;

	constructor(options?: SelectionStateOptions) {
		this.#onChange = options?.onChange;
		this.#getDoc = options?.getDoc;
	}

	get anchor(): SelectionPoint | null {
		return this.#anchor;
	}

	get focus(): SelectionPoint | null {
		return this.#focus;
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

	// Cross-block table endpoints snap to whole rows so highlight, copy, and
	// delete agree (table-endpoint-snap.ts). getDoc is absent in cross-block-only
	// test harnesses, which never carry a table endpoint — fall back to plain
	// normalize.
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

	enterCrossBlock(anchor: SelectionPoint, focus: SelectionPoint): void {
		const a = this.#normalizePoint(anchor);
		const f = this.#normalizePoint(focus);
		// A same-path prose pair is a single-block range the native browser owns —
		// storing it mints an INVISIBLE cross-block state (paints nothing yet
		// suppresses the caret, copies duplicated tail+head, deletes without
		// reparse). Refuse it here so no entry path can. Intra-table rects share the
		// table path legitimately but flag their anchor as a cell coordinate — those
		// pass. The same-offset seed (`enterCrossBlockFromKeyboard`) is kept so its
		// immediate `extendFocus` has an anchor; a real range collapses on that step.
		if (this.#isSamePathProseRange(a, f)) {
			this.#anchor = null;
			this.#focus = null;
		} else {
			this.#assertEndpointCoordinates(a, f);
			this.#anchor = a;
			this.#focus = f;
		}
		this.#onChange?.();
	}

	extendFocus(point: SelectionPoint): void {
		if (!this.#anchor) {
			throw new Error('SelectionState.extendFocus called without an anchor');
		}
		const f = this.#normalizePoint(point);
		// A focus that lands back on the anchor's prose leaf is a contraction to a
		// single-block range — collapse rather than persist the invisible state.
		// Deliberately WITHOUT the `offset !== offset` guard `#isSamePathProseRange`
		// carries: extendFocus never seeds, so a contraction landing exactly on the
		// anchor offset is a fully-collapsed selection that must also not be stored.
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
		this.#onChange?.();
	}

	// G1.29 at the storing seam: #normalizePoint is meant to make this unfireable,
	// and did not for a length-1 table path (its walk runs zero iterations there).
	// Both entries carry it because both store an endpoint pair.
	#assertEndpointCoordinates(anchor: SelectionPoint, focus: SelectionPoint): void {
		const getDoc = this.#getDoc;
		if (!getDoc) return;
		assertInvariant('cross-block-endpoint-coordinates', () =>
			checkCrossBlockEndpointCoordinates(getDoc(), anchor, focus)
		);
	}

	// Same prose leaf, distinct offsets — the range shape that must never enter
	// cross-block state. A collapsed (equal-offset) pair is excluded so the
	// keyboard entry seed survives to its follow-up extend.
	#isSamePathProseRange(a: SelectionPoint, f: SelectionPoint): boolean {
		return (
			pathsEqual(a.path, f.path) && !a.cellCoordinate && !f.cellCoordinate && a.offset !== f.offset
		);
	}

	// The one place every entry path (keyboard, shift-click, drag, select-all,
	// undo restore) funnels through, so a table endpoint can never be stored as
	// a deep cell path with a char offset — the shape that routes rangeDelete
	// down the generic branch and corrupts the grid. Idempotent: an
	// already-normalized point (cellCoordinate, or any non-table path) passes
	// through unchanged. Harnesses without getDoc keep raw points, mirroring
	// the snap fallback in #normalizedSnapped.
	#normalizePoint(point: SelectionPoint): SelectionPoint {
		const getDoc = this.#getDoc;
		if (!getDoc || point.cellCoordinate) return point;
		return normalizeTableEndpoint(getDoc(), point.path, point.offset);
	}

	collapse(): void {
		this.#anchor = null;
		this.#focus = null;
		this.#onChange?.();
	}

	clear(): void {
		this.#anchor = null;
		this.#focus = null;
		this.#selectAllCount = 0;
		this.#onChange?.();
	}

	restoreRoute(
		anchor: SelectionPoint,
		focus: SelectionPoint
	): 'collapsed' | 'single-block' | 'custom' {
		if (!pathsEqual(anchor.path, focus.path)) return 'custom';
		if (anchor.offset === focus.offset) return 'collapsed';
		// Same path, distinct offsets: a table cell rect (flagged endpoint, or a
		// table node under the shared path) paints via the overlay; prose is a
		// native single-block range.
		if (anchor.cellCoordinate || focus.cellCoordinate) return 'custom';
		const getDoc = this.#getDoc;
		if (!getDoc) return 'single-block';
		const node = nodeAt(getDoc(), anchor.path);
		return node?.kind === 'table' ? 'custom' : 'single-block';
	}

	cellDeepPath(point: SelectionPoint): number[] | null {
		const getDoc = this.#getDoc;
		if (!getDoc) return null;
		// A context-established intra-table endpoint is unflagged, yet its offset is
		// a cell index. Mint the flag so cellEndpointDeepPath resolves it; the
		// helper returns null for any non-table path, so a prose/cross-block
		// endpoint stays a no-op.
		const cellPoint: SelectionPoint = point.cellCoordinate
			? point
			: { path: point.path, offset: point.offset, cellCoordinate: true };
		return cellEndpointDeepPath(getDoc(), cellPoint);
	}

	incrementSelectAllCount(): void {
		this.#selectAllCount += 1;
		this.#onChange?.();
	}

	resetSelectAllCount(): void {
		this.#selectAllCount = 0;
		this.#onChange?.();
	}
}
