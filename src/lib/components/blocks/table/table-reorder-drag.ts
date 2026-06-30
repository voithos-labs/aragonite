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
 * Core targeting only — the drop gap resolves against the currently-mounted
 * rows. Autoscroll + off-window (windowed-table) targeting are a later layer.
 */

import { rowDropIndex } from './table-drop-target';

export interface RowReorderLine {
	left: number;
	top: number;
	width: number;
}

export interface RowReorderGeometry {
	/** Viewport-Y boundaries of the mounted rows: each row's top, plus the last row's bottom. */
	rowEdges: number[];
	/** Viewport-left and width of the table, for the insertion line's horizontal span. */
	left: number;
	width: number;
}

export interface RowReorderDragContext {
	fromRowIdx: number;
	rowCount: number;
	getGeometry(): RowReorderGeometry | null;
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
		// Body gaps only: gap 0 sits above the fixed header, so the line never paints
		// there and the dragged row can't land above row 1.
		const gap = Math.max(1, rowDropIndex(clientY, geom.rowEdges));
		ctx.setLine({ left: geom.left, top: geom.rowEdges[gap], width: geom.width });
		// Insert semantics: removing the dragged row shifts later slots down by one.
		const target = gap <= ctx.fromRowIdx ? gap : gap - 1;
		dropTo = Math.max(1, Math.min(target, ctx.rowCount - 1));
	}

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
			if (pending) process(pending.clientY);
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
