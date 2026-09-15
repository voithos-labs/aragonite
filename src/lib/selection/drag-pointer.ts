/**
 * Pointer drag lifecycle for cross-block selection. Runs on a shared
 * `createPointerDragSession`, whose document-level listeners deliver events even after the
 * pointer leaves the originating block.
 */

import type { UserScrollport } from '../cursor/scroll-ancestors';
import type { SelectionState } from './selection-state.svelte';
import type { SelectionEndpoint } from './primitives';
import type { BlockElLookup } from '../editor-keys';
import { caretOffsetAtPoint } from '../cursor/point-offset';
import { applyCollapsedCaret, applySingleBlockRange, clearNativeSelection } from './native-bridge';
import { isWholeBlockEndpoint, type SelectionPoint } from './primitives';
import { comparePaths } from './path-math';
import { createPointerDragSession } from './pointer-session';
import { blockNearPoint } from './nearest-block';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DragContext {
	editorRoot: HTMLElement;
	/** What autoscrolls this drag: an element, or the window (`cursor/scroll-ancestors`). */
	scrollContainer: UserScrollport;
	selection: SelectionState;
	getBlockElByPath: BlockElLookup;
	/** Aborted on editor unmount; forwarded to the session's teardown. */
	lifetimeSignal?: AbortSignal;
	/**
	 * The drag began in the editor's margin, outside every editable element, so no native drag
	 * is extending a selection underneath: the session paints the same-block range itself.
	 */
	paintSameBlock?: boolean;
	/** A drag continuing a double or triple click: the range grows by that click's unit. */
	granularity?: DragGranularity;
}

/** The unit a multi-click drag grows by. Spans are raw offsets; the span the click itself
 *  selected is the floor the range never shrinks below. */
export interface DragGranularity {
	/** The element the click selected in; a pointer over no other block paints here. */
	surface: HTMLElement;
	anchorSpan: { start: number; end: number };
	spanAround(offset: number): { start: number; end: number };
	/** A focus in another block, pushed to the unit's boundary on the side away from the anchor. */
	expandFocus(point: SelectionPoint, side: 'before' | 'after'): SelectionEndpoint;
}

// ── Public entry ───────────────────────────────────────────────────────────

/** Document-level pointer listeners for a cross-block drag started at `down`, plus a disposer. */
export function installDragListener(
	ctx: DragContext,
	anchorPoint: SelectionEndpoint,
	down: PointerEvent
): { dispose(): void } {
	function processMove(clientX: number, clientY: number): void {
		// The nearest block, not the one under the pointer: moves coalesce to one per frame, so a
		// burst ending in the margin would otherwise discard every on-block sample in it, and an
		// autoscrolling drag sends nothing but off-block points.
		const near = blockNearPoint(ctx.editorRoot, clientX, clientY);
		if (!near) return;

		if (ctx.granularity) {
			processGranularMove(ctx.granularity, near, clientX, clientY);
			return;
		}

		if (comparePaths(near.path, anchorPoint.path) === 0) {
			if (!('offset' in anchorPoint)) {
				if (ctx.paintSameBlock) takeAnchorBlockWhole();
				return;
			}
			if (ctx.selection.isCrossBlock) {
				// Pointer returned to the anchor block: collapse so the overlay stops painting a
				// stale remote range. The browser's drag has been extending the native selection
				// underneath all along, so handing back gives the right single-block highlight.
				ctx.selection.collapse();
			}
			if (ctx.paintSameBlock) paintSameBlockRange(near.endpointHere());
			return;
		}

		const focusPoint = near.endpointHere();
		if (!focusPoint) return;
		if (isWholeBlockEndpoint(focusPoint) && !reachedCentreLine(near.path, clientY)) return;
		// A whole-block range re-enters rather than extends: entering picks the anchor's side
		// against the new focus, where extending would keep the block's start as the anchor.
		if (!ctx.selection.isCrossBlock || ctx.selection.wholeUnitPath) {
			ctx.selection.enterCrossBlock(anchorPoint, focusPoint);
		} else {
			ctx.selection.extendFocus(focusPoint);
		}
	}

	// The anchor's side follows the drag's direction (the clicked span ends the range going up,
	// starts it going down), so a direction change re-enters; a same-side move only extends.
	let anchorAfter: boolean | null = null;
	function processGranularMove(
		unit: DragGranularity,
		near: NonNullable<ReturnType<typeof blockNearPoint>>,
		clientX: number,
		clientY: number
	): void {
		const anchorIsChar = 'offset' in anchorPoint && !anchorPoint.cellCoordinate;
		if (!anchorIsChar || comparePaths(near.path, anchorPoint.path) === 0) {
			if (ctx.selection.isCrossBlock) ctx.selection.collapse();
			anchorAfter = null;
			const offset = caretOffsetAtPoint(unit.surface, clientX, clientY);
			if (offset === null) return;
			const span = unit.spanAround(offset);
			unit.surface.focus({ preventScroll: true });
			applySingleBlockRange(
				unit.surface,
				Math.min(unit.anchorSpan.start, span.start),
				Math.max(unit.anchorSpan.end, span.end)
			);
			return;
		}
		const focusPoint = near.endpointHere();
		if (!focusPoint) return;
		if (isWholeBlockEndpoint(focusPoint) && !reachedCentreLine(near.path, clientY)) return;
		const after = comparePaths(near.path, anchorPoint.path) > 0;
		const focus = isWholeBlockEndpoint(focusPoint)
			? focusPoint
			: unit.expandFocus(focusPoint, after ? 'after' : 'before');
		if (!ctx.selection.isCrossBlock || anchorAfter !== after) {
			anchorAfter = after;
			ctx.selection.enterCrossBlock(
				{
					path: anchorPoint.path.slice(),
					offset: after ? unit.anchorSpan.start : unit.anchorSpan.end
				},
				focus
			);
		} else {
			ctx.selection.extendFocus(focus);
		}
	}

	// A block with no positions inside it is in or out as a unit, and it joins the range once
	// the pointer has crossed its centre line from the anchor's side: a sweep that merely
	// touched its edge has not asked for it. Until then the last focus stands.
	function reachedCentreLine(path: number[], clientY: number): boolean {
		const box = ctx.getBlockElByPath(path)?.getBoundingClientRect();
		if (!box) return true;
		const middle = box.top + box.height / 2;
		return comparePaths(anchorPoint.path, path) < 0 ? clientY >= middle : clientY <= middle;
	}

	// A whole-block anchor (a table, an equation) has nothing to paint natively, and a range that
	// appears only once the pointer reaches another block reads as a drag that does nothing. So
	// the block is taken whole the moment the pointer moves (`wholeUnitPath`), and again when
	// the pointer returns from outside.
	function takeAnchorBlockWhole(): void {
		if (ctx.selection.wholeUnitPath) return;
		// Both ends whole: the pointer's position inside the block is not a rectangle to grow (a
		// click beside a table dragged up over it would otherwise select the rows below the
		// pointer, the opposite of the sweep). The block is the unit until the drag leaves it.
		ctx.selection.enterCrossBlock(anchorPoint, {
			path: anchorPoint.path.slice(),
			wholeBlock: true
		});
	}

	// A margin-started drag has no native selection under it, so the range inside the anchor
	// block is written here, and the block takes focus so the range is live for the next key.
	function paintSameBlockRange(
		focusPoint: ReturnType<NonNullable<ReturnType<typeof blockNearPoint>>['endpointHere']>
	): void {
		if (!focusPoint || !('offset' in focusPoint) || !('offset' in anchorPoint)) return;
		const blockEl = ctx.getBlockElByPath(anchorPoint.path);
		if (!blockEl) return;
		// A no-op once it holds focus; the range is a DOM Range, so it is written low-to-high (a
		// drag from the right margin leftward would otherwise collapse it).
		blockEl.focus({ preventScroll: true });
		applySingleBlockRange(
			blockEl,
			Math.min(anchorPoint.offset, focusPoint.offset),
			Math.max(anchorPoint.offset, focusPoint.offset)
		);
	}

	// Pointer may land on a scrollable element directly (the table's `.table-block` edge), so
	// search from `target` itself, not its parent.
	function scrollableSelfOrAncestor(target: HTMLElement): HTMLElement | null {
		let cur: HTMLElement | null = target;
		while (cur && cur !== ctx.editorRoot) {
			const cs = getComputedStyle(cur);
			const ox = cs.overflowX;
			const oy = cs.overflowY;
			if (ox === 'auto' || ox === 'scroll' || oy === 'auto' || oy === 'scroll') return cur;
			cur = cur.parentElement;
		}
		return null;
	}

	return createPointerDragSession(down, {
		onMove: (p) => processMove(p.clientX, p.clientY),
		onEnd: () => {
			if (ctx.selection.isCrossBlock) parkCaretInFocusBlock(ctx);
		},
		autoScroll: {
			getTargets: (clientX, clientY) => {
				const targets: UserScrollport[] = [ctx.scrollContainer];
				const t = document.elementFromPoint(clientX, clientY);
				if (t instanceof HTMLElement) {
					const inner = scrollableSelfOrAncestor(t);
					if (inner && inner !== ctx.scrollContainer) targets.push(inner);
				}
				return targets;
			}
		},
		lifetimeSignal: ctx.lifetimeSignal
	});
}

/**
 * Plant a collapsed native caret in the focus block as a paste/key-dispatch anchor; without it
 * Chromium routes paste events to <body>. The highlight still comes from SelectionOverlay.
 */
function parkCaretInFocusBlock(ctx: DragContext): void {
	const focus = ctx.selection.focus;
	if (!focus) return;
	// A whole-block range has no text node for a caret, so focus goes to the editor root, whose
	// keydown and clipboard handlers serve the range (as they do for a windowed-out block), with
	// no native range left for the browser to act on.
	if (ctx.selection.wholeUnitPath) {
		clearNativeSelection();
		ctx.editorRoot.focus({ preventScroll: true });
		return;
	}
	// A drag ending inside a table leaves a focus addressing the table block by cell index; the
	// landing is the cell that actually holds a caret.
	const landing = ctx.selection.cellLandingFor(focus);
	const blockEl = ctx.getBlockElByPath(landing.path);
	if (!blockEl) return;
	applyCollapsedCaret(blockEl, landing);
}
