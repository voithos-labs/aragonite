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

	enterCrossBlock(anchor: SelectionEndpoint, focus: SelectionEndpoint): void;
	extendFocus(point: SelectionEndpoint): void;
	collapse(): void;
	clear(): void;
	setGapCaret(pos: GapCaretPosition): void;
	/** Silent when no gap is live, so a bare caret placement stays a zero-emission no-op. */
	clearGapCaret(): void;
	incrementSelectAllCount(): void;
	resetSelectAllCount(): void;

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
	/** The deep `[table,row,col]` leaf path of a cell-coordinate point, else null. */
	cellDeepPath(point: SelectionPoint): number[] | null;
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

	get gapCaret(): GapCaretPosition | null {
		return this.#gapCaret;
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
		this.#anchor = null;
		this.#focus = null;
		this.#gapCaret = null;
		this.#notify();
	}

	clear(): void {
		this.#anchor = null;
		this.#focus = null;
		this.#gapCaret = null;
		this.#selectAllCount = 0;
		this.#notify();
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

	cellDeepPath(point: SelectionPoint): number[] | null {
		const getDoc = this.#getDoc;
		if (!getDoc) return null;
		// A context-established intra-table endpoint is unflagged though its offset is a cell
		// index; mint the flag. cellEndpointDeepPath returns null for any non-table path.
		const cellPoint: SelectionPoint = point.cellCoordinate
			? point
			: { path: point.path, offset: point.offset, cellCoordinate: true };
		return cellEndpointDeepPath(getDoc(), cellPoint);
	}

	incrementSelectAllCount(): void {
		this.#selectAllCount += 1;
		this.#notify();
	}

	resetSelectAllCount(): void {
		this.#selectAllCount = 0;
		this.#notify();
	}
}
