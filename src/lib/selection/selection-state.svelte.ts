/**
 * Reactive state class for the cross-block selection layer.
 * Lazy by design: `anchor`, `focus`, and `dragStart` are null in single-block
 * mode (the browser's native selection handles single-block editing). These
 * fields become non-null only when the selection crosses block boundaries.
 *
 * See docs/superpowers/specs/2026-04-15-v0.4-selection-clipboard-design.md
 * Selection Model section for the state machine and transition rules.
 */

import type { SelectionPoint, SelectionDragStart } from './selection-types';
import { normalize } from './selection-point';

// ── Public factory ──────────────────────────────────────────────────────────

export function createSelectionState(): SelectionState {
	return new SelectionStateImpl();
}

// ── Interface ───────────────────────────────────────────────────────────────

export interface SelectionState {
	readonly anchor: SelectionPoint | null;
	readonly focus: SelectionPoint | null;
	readonly dragStart: SelectionDragStart;
	readonly isCrossBlock: boolean;
	readonly start: SelectionPoint | null;
	readonly end: SelectionPoint | null;
	readonly selectAllCount: number;

	beginDrag(point: SelectionPoint): void;
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
	#dragStart: SelectionDragStart = $state(null);
	#selectAllCount: number = $state(0);

	get anchor(): SelectionPoint | null {
		return this.#anchor;
	}

	get focus(): SelectionPoint | null {
		return this.#focus;
	}

	get dragStart(): SelectionDragStart {
		return this.#dragStart;
	}

	get isCrossBlock(): boolean {
		return this.#anchor !== null && this.#focus !== null;
	}

	get start(): SelectionPoint | null {
		if (!this.#anchor || !this.#focus) return null;
		return normalize({ anchor: this.#anchor, focus: this.#focus }).start;
	}

	get end(): SelectionPoint | null {
		if (!this.#anchor || !this.#focus) return null;
		return normalize({ anchor: this.#anchor, focus: this.#focus }).end;
	}

	get selectAllCount(): number {
		return this.#selectAllCount;
	}

	beginDrag(point: SelectionPoint): void {
		this.#dragStart = point;
	}

	enterCrossBlock(anchor: SelectionPoint, focus: SelectionPoint): void {
		this.#anchor = anchor;
		this.#focus = focus;
	}

	extendFocus(point: SelectionPoint): void {
		if (!this.#anchor) {
			throw new Error('SelectionState.extendFocus called without an anchor');
		}
		this.#focus = point;
	}

	collapse(): void {
		this.#anchor = null;
		this.#focus = null;
	}

	clear(): void {
		this.#anchor = null;
		this.#focus = null;
		this.#dragStart = null;
		this.#selectAllCount = 0;
	}

	incrementSelectAllCount(): void {
		this.#selectAllCount += 1;
	}

	resetSelectAllCount(): void {
		this.#selectAllCount = 0;
	}
}
