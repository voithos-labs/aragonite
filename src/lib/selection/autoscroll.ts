/**
 * Pointer-edge autoscroll RAF loop, shared between cross-block drag and
 * intra-table drag. Caller supplies the live pointer and the list of scroll
 * targets to evaluate each frame; the loop scrolls any target whose rect is
 * within `threshold` of the current pointer.
 */

const DEFAULT_THRESHOLD = 30;

export interface AutoScrollDeps {
	getPointer: () => { clientX: number; clientY: number } | null;
	getTargets: (clientX: number, clientY: number) => HTMLElement[];
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

	function dxFor(rect: DOMRect, x: number): number {
		if (axis === 'vertical') return 0;
		if (x < rect.left + threshold) return -((rect.left + threshold - x) / 2);
		if (x > rect.right - threshold) return (x - (rect.right - threshold)) / 2;
		return 0;
	}
	function dyFor(rect: DOMRect, y: number): number {
		if (axis === 'horizontal') return 0;
		if (y < rect.top + threshold) return -((rect.top + threshold - y) / 2);
		if (y > rect.bottom - threshold) return (y - (rect.bottom - threshold)) / 2;
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
			const rect = t.getBoundingClientRect();
			const dx = dxFor(rect, p.clientX);
			const dy = dyFor(rect, p.clientY);
			// Count only motion that actually moved the target: a target already at
			// its scroll limit ignores the write, and marking it scrolled would spin
			// the rAF loop while the pointer sits pinned in the edge band.
			if (dx !== 0) {
				const before = t.scrollLeft;
				t.scrollLeft += dx;
				if (t.scrollLeft !== before) scrolled = true;
			}
			if (dy !== 0) {
				const before = t.scrollTop;
				t.scrollTop += dy;
				if (t.scrollTop !== before) scrolled = true;
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
			const rect = t.getBoundingClientRect();
			return dxFor(rect, p.clientX) !== 0 || dyFor(rect, p.clientY) !== 0;
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
