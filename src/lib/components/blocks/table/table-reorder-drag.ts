/**
 * Pointer drag-to-reorder for table rows and columns. Started from a grip's
 * pointerdown; a shared `createPointerDragSession` tracks the pointer, paints a
 * single insertion line (no tree mutation, no reflow), and commits ONE move on
 * release.
 *
 * Rows and columns share ONE lifecycle (`startTableReorderDrag`) and diverge only
 * in geometry: each axis supplies a pure `process(pointer)` that returns the
 * insertion line and clamped drop index for the current pointer. Rows are
 * windowed and sit under a fixed header (the caller blocks header drags; the row
 * process reports each mounted row's ABSOLUTE index and autoscrolls to mount
 * off-window drop targets). Columns are neither windowed nor header-fixed, so an
 * edge index maps straight to a column index and every column is movable; a wide
 * table's horizontal autoscroll only brings clipped columns into view (no mount).
 *
 * A gesture under the move threshold is a CLICK, not a drag: the controller
 * never reports a drag, so the grip's affordance menu still opens.
 */

import { rowDropIndex, columnDropIndex } from './table-drop-target';
import { createPointerDragSession, type PointerPosition } from '../../../selection/pointer-session';

// Past this much pointer travel the gesture is a drag, not a menu-opening click.
const DRAG_THRESHOLD_PX = 4;

// ── Shared lifecycle ──────────────────────────────────────────────────────────

/** Members every reorder-axis context shares; the row/column contexts extend it. */
interface AxisReorderDragContext<TLine> {
	getScrollContainer(): HTMLElement | null;
	setLine(line: TLine | null): void;
	/** Marks the gesture a drag (not a click) so the grip's menu stays closed. */
	onDragRecognized(): void;
	commit(from: number, to: number): void;
	/** Aborted on editor unmount — tears down a drag whose pointerup can't fire. */
	lifetimeSignal?: AbortSignal;
}

export interface TableReorderDragContext<TLine> extends AxisReorderDragContext<TLine> {
	from: number;
	/**
	 * Pure per-axis map from the live pointer to the insertion line and clamped
	 * drop index (null when geometry is unavailable). RETURNS its result — the
	 * shared controller owns dropTo and forwards the line to setLine — so the axis
	 * clamps stay unit-testable in isolation.
	 */
	process(pointer: PointerPosition): { line: TLine; dropTo: number } | null;
	/** The autoscroll axis only — rows scroll both ways, a wide table's columns horizontally. */
	autoScrollAxis: 'horizontal' | 'vertical' | 'both';
}

export function startTableReorderDrag<TLine>(
	down: PointerEvent,
	ctx: TableReorderDragContext<TLine>
): void {
	let dragging = false;
	let dropTo: number | null = null;

	createPointerDragSession(down, {
		threshold: DRAG_THRESHOLD_PX,
		onDragRecognized: () => {
			dragging = true;
			ctx.onDragRecognized();
		},
		onMove: (pointer) => {
			const result = ctx.process(pointer);
			if (!result) return;
			dropTo = result.dropTo;
			ctx.setLine(result.line);
		},
		// A reorder commits only on release, and only once the gesture cleared the
		// click threshold — a sub-threshold press is a menu-opening click.
		onEnd: (reason) => {
			if (reason === 'up' && dragging && dropTo !== null && dropTo !== ctx.from) {
				ctx.commit(ctx.from, dropTo);
			}
		},
		onTeardown: () => ctx.setLine(null),
		autoScroll: {
			axis: ctx.autoScrollAxis,
			getTargets: () => {
				const sc = ctx.getScrollContainer();
				return sc ? [sc] : [];
			}
		},
		escape: true,
		// Disabled up front (not at threshold): a native text selection can begin
		// from the empty grip before the first qualifying move and survive the drag.
		disableUserSelect: true,
		lifetimeSignal: ctx.lifetimeSignal
	});
}

// ── Row drag ────────────────────────────────────────────────────────────────

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

export interface RowReorderDragContext extends AxisReorderDragContext<RowReorderLine> {
	fromRowIdx: number;
	/** Live total row count — read each move so the header clamp tracks edits/re-slices. */
	getRowCount(): number;
	getGeometry(): RowReorderGeometry | null;
}

export function startRowReorderDrag(down: PointerEvent, ctx: RowReorderDragContext): void {
	startTableReorderDrag<RowReorderLine>(down, {
		from: ctx.fromRowIdx,
		autoScrollAxis: 'both',
		getScrollContainer: ctx.getScrollContainer,
		setLine: ctx.setLine,
		onDragRecognized: ctx.onDragRecognized,
		commit: ctx.commit,
		lifetimeSignal: ctx.lifetimeSignal,
		process(pointer) {
			const geom = ctx.getGeometry();
			if (!geom) return null;
			// rowDropIndex gives the LOCAL edge among mounted rows; gapIndices maps it to
			// the absolute gap so a window scrolled past row 0 still targets the right row.
			let edge = rowDropIndex(pointer.clientY, geom.rowEdges);
			// Never land above the fixed header (gap 0). Only reachable when row 0 is
			// mounted; once it windows out every mounted gap is already >= 1.
			if (geom.gapIndices[edge] < 1) edge = Math.min(edge + 1, geom.gapIndices.length - 1);
			const gap = geom.gapIndices[edge];
			// Insert semantics: removing the dragged row shifts later slots down by one.
			const target = gap <= ctx.fromRowIdx ? gap : gap - 1;
			const dropTo = Math.max(1, Math.min(target, ctx.getRowCount() - 1));
			return { line: { left: geom.left, top: geom.rowEdges[edge], width: geom.width }, dropTo };
		}
	});
}

// ── Column drag ───────────────────────────────────────────────────────────────

export interface ColumnReorderLine {
	left: number;
	top: number;
	height: number;
}

export interface ColumnReorderGeometry {
	/** Viewport-X boundaries of the columns: each column's left, plus the last column's right. */
	colEdges: number[];
	/** Viewport-top and height of the table, for the insertion line's vertical span. */
	top: number;
	height: number;
}

export interface ColumnReorderDragContext extends AxisReorderDragContext<ColumnReorderLine> {
	fromColIdx: number;
	/** Live total column count — read each move so the clamp tracks edits. */
	getColCount(): number;
	getGeometry(): ColumnReorderGeometry | null;
}

export function startColumnReorderDrag(down: PointerEvent, ctx: ColumnReorderDragContext): void {
	startTableReorderDrag<ColumnReorderLine>(down, {
		from: ctx.fromColIdx,
		// Pinned in the table's top band; vertical evaluation would spin the loop on a
		// `.table-block` that only scrolls horizontally (autoscroll.ts § axis).
		autoScrollAxis: 'horizontal',
		getScrollContainer: ctx.getScrollContainer,
		setLine: ctx.setLine,
		onDragRecognized: ctx.onDragRecognized,
		commit: ctx.commit,
		lifetimeSignal: ctx.lifetimeSignal,
		process(pointer) {
			const geom = ctx.getGeometry();
			if (!geom) return null;
			// Columns aren't windowed and have no fixed header, so the edge index IS the
			// drop gap — no gap remap, no leading clamp like the row path.
			const gap = columnDropIndex(pointer.clientX, geom.colEdges);
			// Insert semantics: removing the dragged column shifts later slots left by one.
			const target = gap <= ctx.fromColIdx ? gap : gap - 1;
			const dropTo = Math.max(0, Math.min(target, ctx.getColCount() - 1));
			return { line: { left: geom.colEdges[gap], top: geom.top, height: geom.height }, dropTo };
		}
	});
}
