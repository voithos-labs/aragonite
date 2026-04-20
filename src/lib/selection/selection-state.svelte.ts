/**
 * Reactive state class for the cross-block selection layer.
 * Lazy by design: `anchor`, `focus`, and `dragStart` are null in single-block
 * mode (the browser's native selection handles single-block editing). These
 * fields become non-null only when the selection crosses block boundaries.
 *
 * See docs/design/editor/editor.md — Selection section for the state
 * machine and transition rules.
 */

import type { SelectionPoint, SelectionDragStart } from './primitives';
import { normalize } from './primitives';

// ── Public factory ──────────────────────────────────────────────────────────

export interface SelectionStateOptions {
	/**
	 * Fired after any state mutation (anchor/focus/dragStart/selectAllCount).
	 * No payload — subscribers call `editor.getSelection()` to read the new
	 * value. Used by Editor.svelte to bridge SelectionState mutations onto
	 * the `selectionChange` event on `editor.events`.
	 */
	onChange?: () => void;
}

export function createSelectionState(options?: SelectionStateOptions): SelectionState {
	return new SelectionStateImpl(options);
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
	#onChange?: () => void;

	constructor(options?: SelectionStateOptions) {
		this.#onChange = options?.onChange;
	}

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
		this.#onChange?.();
	}

	enterCrossBlock(anchor: SelectionPoint, focus: SelectionPoint): void {
		this.#anchor = anchor;
		this.#focus = focus;
		this.#onChange?.();
	}

	extendFocus(point: SelectionPoint): void {
		if (!this.#anchor) {
			throw new Error('SelectionState.extendFocus called without an anchor');
		}
		this.#focus = point;
		this.#onChange?.();
	}

	collapse(): void {
		this.#anchor = null;
		this.#focus = null;
		this.#onChange?.();
	}

	clear(): void {
		this.#anchor = null;
		this.#focus = null;
		this.#dragStart = null;
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
