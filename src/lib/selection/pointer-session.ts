/**
 * Shared pointer-drag session: the document-listener + rAF-coalescing scaffold
 * every drag lifecycle builds on (cross-block selection, block/row/column
 * reorder, intra-table cell selection). Owns the pointer-ownership filter,
 * autoscroll wiring, and idempotent teardown; callers supply the per-surface
 * move/end behavior, scroll targets, and the options that genuinely differ
 * (click threshold, Escape, userSelect).
 *
 * rAF here is frame-paced pointermove coalescing (one handler per frame), not
 * async sequencing — G4.4 allowlisted.
 */

import { createAutoScroll, type AutoScrollDeps } from './autoscroll';

export interface PointerPosition {
	clientX: number;
	clientY: number;
}

export interface PointerDragSessionOptions {
	/** Coalesced to one call per animation frame with the latest pointer. */
	onMove(pointer: PointerPosition): void;
	/**
	 * pointerup / pointercancel finalize, run after the pending move is flushed
	 * and the session is torn down. NOT run on Escape or lifetime abort — those
	 * are pure teardowns (an unmount must not, e.g., park a caret into a tree
	 * that is going away).
	 */
	onEnd?(reason: 'up' | 'cancel'): void;
	/** Caller cleanup, run once on every teardown path (up, cancel, Escape, abort). */
	onTeardown?(): void;
	/** Scroll targets + axis; the session supplies the live pointer and rescroll. */
	autoScroll: Pick<AutoScrollDeps, 'getTargets' | 'axis'>;
	/**
	 * Drag/click discriminator in px. Below this travel from `down` a move does
	 * not process and the gesture stays a click; the first qualifying move flips
	 * it to a drag and fires `onDragRecognized`. Omit where the pointerdown
	 * already committed to a drag (no click affordance to protect).
	 */
	threshold?: number;
	onDragRecognized?(): void;
	/** Install a document keydown so Escape tears the session down. */
	escape?: boolean;
	/** Suppress native text selection for the drag's duration. */
	disableUserSelect?: boolean;
	/**
	 * Aborted on editor unmount. Without it an unmount mid-drag leaks the
	 * document listeners — pointerup never fires once the originating element is
	 * gone.
	 */
	lifetimeSignal?: AbortSignal;
}

export function createPointerDragSession(
	down: PointerEvent,
	opts: PointerDragSessionOptions
): { dispose(): void } {
	const pointerId = down.pointerId;
	const startX = down.clientX;
	const startY = down.clientY;
	const threshold = opts.threshold;
	let dragging = threshold === undefined;
	let pending: PointerPosition | null = null;
	let rafId: number | null = null;

	const autoScroll = createAutoScroll({
		axis: opts.autoScroll.axis,
		getPointer: () => pending,
		getTargets: opts.autoScroll.getTargets,
		onScrolled: () => {
			if (pending) opts.onMove(pending);
		}
	});

	function onPointerMove(e: PointerEvent): void {
		if (!dragging && threshold !== undefined) {
			const moved =
				Math.abs(e.clientX - startX) >= threshold || Math.abs(e.clientY - startY) >= threshold;
			if (!moved) return;
			dragging = true;
			opts.onDragRecognized?.();
		}
		pending = { clientX: e.clientX, clientY: e.clientY };
		if (rafId !== null) return;
		rafId = requestAnimationFrame(() => {
			rafId = null;
			if (!pending) return;
			opts.onMove(pending);
			autoScroll.maybeStart();
		});
	}

	// A release before the coalescing rAF runs would otherwise drop the final
	// move — a stale drop index, or isCrossBlock false on a fast flick /
	// pointercancel (touch, Tauri WebView2). Guard on a LIVE rAF so an
	// already-processed move is never replayed (double-commit / double-extend).
	function flushPendingMove(): void {
		if (rafId !== null && pending) opts.onMove(pending);
	}

	let disposed = false;
	function dispose(): void {
		if (disposed) return;
		disposed = true;
		document.removeEventListener('pointermove', onPointerMove);
		document.removeEventListener('pointerup', onPointerUp);
		document.removeEventListener('pointercancel', onPointerCancel);
		if (opts.escape) document.removeEventListener('keydown', onKeyDown, true);
		opts.lifetimeSignal?.removeEventListener('abort', onAbort);
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		autoScroll.dispose();
		if (opts.disableUserSelect) document.body.style.userSelect = '';
		opts.onTeardown?.();
		pending = null;
	}

	// Only the pointer that opened the drag ends it: a second touch's up/cancel
	// would otherwise commit or tear down someone else's gesture.
	function onPointerUp(e: PointerEvent): void {
		if (e.pointerId !== pointerId) return;
		flushPendingMove();
		dispose();
		opts.onEnd?.('up');
	}

	// Touch/stylus and Tauri WebView2 surface gestures fire pointercancel instead
	// of pointerup when the OS reclaims the pointer; without this listener the
	// pointermove + rAF would leak until editor unmount.
	function onPointerCancel(e: PointerEvent): void {
		if (e.pointerId !== pointerId) return;
		flushPendingMove();
		dispose();
		opts.onEnd?.('cancel');
	}

	// Editor unmount aborts the lifetime, not a pointer — always tears down, and
	// never runs onEnd (no gesture result to finalize into an unmounting tree).
	function onAbort(): void {
		dispose();
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === 'Escape') dispose();
	}

	if (opts.lifetimeSignal?.aborted) {
		return { dispose };
	}

	if (opts.disableUserSelect) document.body.style.userSelect = 'none';
	document.addEventListener('pointermove', onPointerMove);
	document.addEventListener('pointerup', onPointerUp);
	document.addEventListener('pointercancel', onPointerCancel);
	if (opts.escape) document.addEventListener('keydown', onKeyDown, true);
	opts.lifetimeSignal?.addEventListener('abort', onAbort, { once: true });

	return { dispose };
}
