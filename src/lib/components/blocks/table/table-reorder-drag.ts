/**
 * Pointer drag-to-reorder for table BODY rows. Started from a row grip's
 * pointerdown; document-level listeners track the pointer, paint a single
 * insertion line (no tree mutation, no reflow), and commit ONE row move on
 * release. Mirrors editor-actions/reorder-drag.ts's lifecycle.
 *
 * A gesture under the move threshold is a CLICK, not a drag: the controller
 * never reports a drag, so the grip's affordance menu still opens. The caller
 * is responsible for not starting a drag on the fixed header row.
 *
 * Off-window aware: geometry reports each mounted row's ABSOLUTE index, so the
 * drop gap resolves correctly under row windowing; pointer-edge autoscroll mounts
 * off-window rows so they become reachable drop targets (rAF loop, mirroring
 * editor-actions/reorder-drag.ts).
 */

import { rowDropIndex } from './table-drop-target';
import { createAutoScroll } from '../../../selection/autoscroll';

export interface RowReorderLine {
	left: number;
	top: number;
	width: number;
}

export interface RowReorderGeometry {
	/** Viewport-Y boundaries of the mounted rows: each row's top, plus the last row's bottom. */
	rowEdges: number[];
	/**
	 * Absolute gap index for each `rowEdges` entry — a mounted row's top is the gap
	 * before that row; the trailing entry is the gap after the last mounted row. Lets
	 * the drop map a local edge to a body position even when the window has scrolled
	 * past row 0, where local index no longer equals absolute index.
	 */
	gapIndices: number[];
	/** Viewport-left and width of the table, for the insertion line's horizontal span. */
	left: number;
	width: number;
}

export interface RowReorderDragContext {
	fromRowIdx: number;
	/** Live total row count — read each move so the header clamp tracks edits/re-slices. */
	getRowCount(): number;
	getGeometry(): RowReorderGeometry | null;
	/** The element row-windowing scrolls (editor root); autoscrolled to mount off-window rows. */
	getScrollContainer(): HTMLElement | null;
	setLine(line: RowReorderLine | null): void;
	/** Marks the gesture a drag (not a click) so the grip's menu stays closed. */
	onDragRecognized(): void;
	commit(from: number, to: number): void;
	/** Aborted on editor unmount — tears down a drag whose pointerup can't fire. */
	lifetimeSignal?: AbortSignal;
}

// Past this much pointer travel the gesture is a drag, not a menu-opening click.
const DRAG_THRESHOLD_PX = 4;

export function startRowReorderDrag(down: PointerEvent, ctx: RowReorderDragContext): void {
	const startX = down.clientX;
	const startY = down.clientY;
	let dragging = false;
	let dropTo: number | null = null;
	let pending: { clientX: number; clientY: number } | null = null;
	let rafId: number | null = null;

	function process(clientY: number): void {
		const geom = ctx.getGeometry();
		if (!geom) return;
		// rowDropIndex gives the LOCAL edge among mounted rows; gapIndices maps it to
		// the absolute gap so a window scrolled past row 0 still targets the right row.
		let edge = rowDropIndex(clientY, geom.rowEdges);
		// Never land above the fixed header (gap 0). Only reachable when row 0 is
		// mounted; once it windows out every mounted gap is already >= 1.
		if (geom.gapIndices[edge] < 1) edge = Math.min(edge + 1, geom.gapIndices.length - 1);
		const gap = geom.gapIndices[edge];
		ctx.setLine({ left: geom.left, top: geom.rowEdges[edge], width: geom.width });
		// Insert semantics: removing the dragged row shifts later slots down by one.
		const target = gap <= ctx.fromRowIdx ? gap : gap - 1;
		dropTo = Math.max(1, Math.min(target, ctx.getRowCount() - 1));
	}

	const autoScroll = createAutoScroll({
		getPointer: () => pending,
		getTargets: () => {
			const sc = ctx.getScrollContainer();
			return sc ? [sc] : [];
		},
		onScrolled: () => {
			if (pending) process(pending.clientY);
		}
	});

	function onMove(e: PointerEvent): void {
		if (!dragging) {
			const moved =
				Math.abs(e.clientX - startX) >= DRAG_THRESHOLD_PX ||
				Math.abs(e.clientY - startY) >= DRAG_THRESHOLD_PX;
			if (!moved) return;
			dragging = true;
			ctx.onDragRecognized();
		}
		pending = { clientX: e.clientX, clientY: e.clientY };
		if (rafId !== null) return;
		rafId = requestAnimationFrame(() => {
			rafId = null;
			if (!pending) return;
			process(pending.clientY);
			autoScroll.maybeStart();
		});
	}

	let done = false;
	function teardown(): void {
		if (done) return;
		done = true;
		document.removeEventListener('pointermove', onMove);
		document.removeEventListener('pointerup', onUp);
		document.removeEventListener('pointercancel', onCancel);
		document.removeEventListener('keydown', onKey, true);
		ctx.lifetimeSignal?.removeEventListener('abort', onCancel);
		if (rafId !== null) cancelAnimationFrame(rafId);
		autoScroll.dispose();
		document.body.style.userSelect = '';
		ctx.setLine(null);
		pending = null;
	}

	function commitDrop(): void {
		// A release before the coalescing rAF runs would otherwise commit a stale
		// dropTo (or none) — flush the last move first.
		if (rafId !== null && pending) process(pending.clientY);
		const to = dropTo;
		const wasDragging = dragging;
		teardown();
		if (wasDragging && to !== null && to !== ctx.fromRowIdx) ctx.commit(ctx.fromRowIdx, to);
	}
	function onUp(): void {
		commitDrop();
	}
	function onCancel(): void {
		teardown();
	}
	function onKey(e: KeyboardEvent): void {
		if (e.key === 'Escape') teardown();
	}

	// Disabled up front (not at threshold): a native text selection can begin from
	// the empty grip before the first qualifying move, which would survive the drag.
	document.body.style.userSelect = 'none';
	document.addEventListener('pointermove', onMove);
	document.addEventListener('pointerup', onUp);
	document.addEventListener('pointercancel', onCancel);
	document.addEventListener('keydown', onKey, true);
	ctx.lifetimeSignal?.addEventListener('abort', onCancel, { once: true });
}
