/**
 * The shared pointer-drag session every drag builds on: page-level listeners, one move per
 * animation frame, the pointer-id filter, autoscroll, and a teardown that is safe to run twice.
 * The release resolves the drag at its own point and is heard here first (window, capture phase),
 * so a popover the release reveals never covers what the drag hit-tests (G4.225).
 */

import { imeOwnsKey } from '../browser/composition';
import { createAutoScroll, type AutoScrollDeps } from './autoscroll';
import { isTouchPointer } from './pointer-gesture';

export interface PointerPosition {
	clientX: number;
	clientY: number;
}

export interface PointerDragSessionOptions {
	/** Who drags for a finger: `own` for a control that takes the touch (`touch-action: none`), or
	 *  `browser`, where a finger's press opens no session and the browser scrolls or selects. */
	touch: 'own' | 'browser';
	/** Coalesced to one call per animation frame with the latest pointer: intermediate positions
	 *  are dropped, so a consumer must answer the point it gets rather than wait for a better one. */
	onMove(pointer: PointerPosition): void;
	/** Runs on pointerup or pointercancel, after the drag resolves its last point and the session
	 *  tears down; Escape and a lifetime abort only tear down. */
	onEnd?(reason: 'up' | 'cancel'): void;
	/** Caller cleanup, run once on every teardown path (up, cancel, Escape, abort). */
	onTeardown?(): void;
	/** Scroll targets + axis; the session supplies the live pointer and rescroll. */
	autoScroll: Pick<AutoScrollDeps, 'getTargets' | 'axis'>;
	/** Install a document keydown so Escape tears the session down. */
	escape?: boolean;
	/** Suppress native text selection for the drag's duration. */
	disableUserSelect?: boolean;
	/** Aborted on editor unmount; without it an unmount mid-drag leaks the document listeners,
	 *  since pointerup never fires once the originating element is gone. */
	lifetimeSignal?: AbortSignal;
}

export function createPointerDragSession(
	down: PointerEvent,
	opts: PointerDragSessionOptions
): { dispose(): void } {
	const pointerId = down.pointerId;
	let pending: PointerPosition | null = null;
	let resolved: PointerPosition | null = null;
	let rafId: number | null = null;

	function resolve(pointer: PointerPosition): void {
		resolved = pointer;
		opts.onMove(pointer);
	}

	const autoScroll = createAutoScroll({
		axis: opts.autoScroll.axis,
		getPointer: () => pending,
		getTargets: opts.autoScroll.getTargets,
		onScrolled: () => {
			if (pending) resolve(pending);
		}
	});

	function onPointerMove(e: PointerEvent): void {
		pending = { clientX: e.clientX, clientY: e.clientY };
		if (rafId !== null) return;
		rafId = requestAnimationFrame(() => {
			rafId = null;
			if (!pending) return;
			resolve(pending);
			autoScroll.maybeStart();
		});
	}

	// The last move can arrive after the release, so the release's own point is the latest; a
	// drag that never moved is a click and resolves nothing.
	function resolveRelease(e: PointerEvent): void {
		if (!pending) return;
		if (resolved && resolved.clientX === e.clientX && resolved.clientY === e.clientY) return;
		resolve({ clientX: e.clientX, clientY: e.clientY });
	}

	// A cancel's coordinates are not a point the user chose, so only a move still waiting runs.
	function flushPendingMove(): void {
		if (rafId !== null && pending) resolve(pending);
	}

	let disposed = false;
	function dispose(): void {
		if (disposed) return;
		disposed = true;
		document.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', onPointerUp, true);
		window.removeEventListener('pointercancel', onPointerCancel, true);
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

	// Only the pointer that opened the drag ends it: a second touch's up/cancel would otherwise
	// commit or tear down someone else's gesture.
	function onPointerUp(e: PointerEvent): void {
		if (e.pointerId !== pointerId) return;
		resolveRelease(e);
		dispose();
		opts.onEnd?.('up');
	}

	// Touch/stylus and Tauri WebView2 fire pointercancel instead of pointerup when the OS
	// reclaims the pointer; without this the pointermove + rAF leak until editor unmount.
	function onPointerCancel(e: PointerEvent): void {
		if (e.pointerId !== pointerId) return;
		flushPendingMove();
		dispose();
		opts.onEnd?.('cancel');
	}

	// Editor unmount aborts the lifetime, not a pointer: always tears down, never runs onEnd
	// (no gesture result to finalize into an unmounting tree).
	function onAbort(): void {
		dispose();
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (imeOwnsKey(e)) return;
		if (e.key === 'Escape') dispose();
	}

	if (opts.lifetimeSignal?.aborted || (opts.touch === 'browser' && isTouchPointer(down))) {
		return { dispose };
	}

	if (opts.disableUserSelect) document.body.style.userSelect = 'none';
	document.addEventListener('pointermove', onPointerMove);
	window.addEventListener('pointerup', onPointerUp, true);
	window.addEventListener('pointercancel', onPointerCancel, true);
	if (opts.escape) document.addEventListener('keydown', onKeyDown, true);
	opts.lifetimeSignal?.addEventListener('abort', onAbort, { once: true });

	return { dispose };
}
