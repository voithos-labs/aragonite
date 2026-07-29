/**
 * Pointer-edge autoscroll RAF loop, shared between cross-block drag and
 * intra-table drag. Caller supplies the live pointer and the list of scroll
 * targets to evaluate each frame; the loop scrolls any target whose scrollport is
 * within `threshold` of the current pointer.
 *
 * A target may be the window (`cursor/scroll-ancestors`), and it answers the two
 * halves from different places on purpose: the scrollport to measure is the
 * viewport, while the box to write is `document.scrollingElement`. Substituting the
 * scrolling element for both puts the document's own box — thousands of pixels tall
 * — into the edge math, where the pointer never reaches an edge.
 */
import type { UserScrollport } from '../cursor/scroll-ancestors';

const DEFAULT_THRESHOLD = 30;

/** The four edges the pointer is compared against. `getBoundingClientRect()` is one. */
interface EdgeBox {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

function scrollportOf(target: UserScrollport): EdgeBox {
	if (target !== window) return (target as HTMLElement).getBoundingClientRect();
	// clientWidth/clientHeight, not innerWidth/innerHeight: the viewport without its
	// scrollbars, which is the box the pointer's edge band belongs to.
	const doc = document.documentElement;
	return { left: 0, top: 0, right: doc.clientWidth, bottom: doc.clientHeight };
}

function scrollerOf(target: UserScrollport): Element | null {
	return target === window ? document.scrollingElement : (target as HTMLElement);
}

export interface AutoScrollDeps {
	getPointer: () => { clientX: number; clientY: number } | null;
	getTargets: (clientX: number, clientY: number) => UserScrollport[];
	onScrolled?: () => void;
	threshold?: number;
	/**
	 * Restrict scrolling to one axis (default both). The column reorder drag pins
	 * the pointer in the table's top band, where unrestricted vertical evaluation
	 * would spin the loop on a `.table-block` that only scrolls horizontally.
	 */
	axis?: 'horizontal' | 'vertical' | 'both';
}

export interface AutoScrollHandle {
	maybeStart(): void;
	dispose(): void;
}

export function createAutoScroll(deps: AutoScrollDeps): AutoScrollHandle {
	const threshold = deps.threshold ?? DEFAULT_THRESHOLD;
	const axis = deps.axis ?? 'both';
	let rafId: number | null = null;

	function dxFor(port: EdgeBox, x: number): number {
		if (axis === 'vertical') return 0;
		if (x < port.left + threshold) return -((port.left + threshold - x) / 2);
		if (x > port.right - threshold) return (x - (port.right - threshold)) / 2;
		return 0;
	}
	function dyFor(port: EdgeBox, y: number): number {
		if (axis === 'horizontal') return 0;
		if (y < port.top + threshold) return -((port.top + threshold - y) / 2);
		if (y > port.bottom - threshold) return (y - (port.bottom - threshold)) / 2;
		return 0;
	}

	const step = () => {
		const p = deps.getPointer();
		if (!p) {
			rafId = null;
			return;
		}
		let scrolled = false;
		for (const t of deps.getTargets(p.clientX, p.clientY)) {
			const port = scrollportOf(t);
			const dx = dxFor(port, p.clientX);
			const dy = dyFor(port, p.clientY);
			const scroller = scrollerOf(t);
			if (!scroller) continue;
			// Count only motion that actually moved the target: a target already at
			// its scroll limit ignores the write, and marking it scrolled would spin
			// the rAF loop while the pointer sits pinned in the edge band.
			if (dx !== 0) {
				const before = scroller.scrollLeft;
				scroller.scrollLeft += dx;
				if (scroller.scrollLeft !== before) scrolled = true;
			}
			if (dy !== 0) {
				const before = scroller.scrollTop;
				scroller.scrollTop += dy;
				if (scroller.scrollTop !== before) scrolled = true;
			}
		}
		if (!scrolled) {
			rafId = null;
			return;
		}
		deps.onScrolled?.();
		rafId = requestAnimationFrame(step);
	};

	function maybeStart(): void {
		if (rafId !== null) return;
		const p = deps.getPointer();
		if (!p) return;
		const inAnyThreshold = deps.getTargets(p.clientX, p.clientY).some((t) => {
			const port = scrollportOf(t);
			return dxFor(port, p.clientX) !== 0 || dyFor(port, p.clientY) !== 0;
		});
		if (!inAnyThreshold) return;
		rafId = requestAnimationFrame(step);
	}

	function dispose(): void {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
	}

	return { maybeStart, dispose };
}
