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
import { normalizeTableEndpoint, snapCrossBlockTableEndpoints } from './table-endpoint-snap';
import { pathsEqual } from './path-math';

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
		this.#anchor = this.#normalizePoint(anchor);
		this.#focus = this.#normalizePoint(focus);
		this.#onChange?.();
	}

	extendFocus(point: SelectionPoint): void {
		if (!this.#anchor) {
			throw new Error('SelectionState.extendFocus called without an anchor');
		}
		this.#focus = this.#normalizePoint(point);
		this.#onChange?.();
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

	incrementSelectAllCount(): void {
		this.#selectAllCount += 1;
		this.#onChange?.();
	}

	resetSelectAllCount(): void {
		this.#selectAllCount = 0;
		this.#onChange?.();
	}
}
