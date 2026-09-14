/**
 * The scroll container windowing measures and writes, as one shape whatever owns the scroll:
 * the editor root under `scrollMode="self"`, the ancestor `userScrollportFor` resolves (or the
 * page viewport) under `"host"`. One implementation reads this; the mode only picks the target.
 * See `docs/design/virtual-rendering.md`.
 */
import type { UserScrollport } from './scroll-ancestors';

export interface Scrollport {
	/** Client-coordinate top of the visible box — 0 when the page viewport is the port. Paired
	 *  with a block's own client rect, it maps that block into the port's content space. */
	viewportTop(): number;
	viewportHeight(): number;
	/** Width available to content, for the height oracle's line-wrap estimates. */
	contentWidth(): number;
	scrollTop(): number;
	setScrollTop(value: number): void;
	/** Move by `delta`. The only relative write: see {@link withRelativeScroll}. */
	scrollBy(delta: number): void;
	/** Fires on user and programmatic scrolls alike; returns the unsubscribe. */
	subscribe(onScroll: () => void): () => void;
}

export function createScrollport(target: UserScrollport): Scrollport {
	return withRelativeScroll(
		target === window ? pageScrollport() : elementScrollport(target as HTMLElement)
	);
}

/**
 * Adds the relative write every corrector goes through. A scroller snaps a fractional write to
 * a whole device pixel and reports the snapped value back, so a run of relative corrections (a
 * mode flip fires one per re-measured block) would drop that fraction every time and slide the
 * reader's content by the sum. The refused fraction carries into the next call instead.
 */
export function withRelativeScroll(base: Omit<Scrollport, 'scrollBy'>): Scrollport {
	let carried = 0;
	let written: number | null = null;
	return {
		...base,
		setScrollTop(value) {
			base.setScrollTop(value);
			carried = 0;
			written = null;
		},
		scrollBy(delta) {
			const from = base.scrollTop();
			// Anything that moved the port since our own write (the reader, a reveal) leaves the
			// carried fraction describing a position nobody holds any more.
			const target = from + (written === from ? carried : 0) + delta;
			base.setScrollTop(target);
			written = base.scrollTop();
			const refused = target - written;
			// Only the snap's own fraction carries; a clamp at either end is a real refusal.
			carried = Math.abs(refused) < 1 ? refused : 0;
		}
	};
}

// ── Internal ───────────────────────────────────────────────────────────────

function elementScrollport(el: HTMLElement): Omit<Scrollport, 'scrollBy'> {
	return {
		viewportTop: () => el.getBoundingClientRect().top,
		viewportHeight: () => el.clientHeight,
		contentWidth: () => el.clientWidth,
		scrollTop: () => el.scrollTop,
		setScrollTop: (value) => {
			el.scrollTop = value;
		},
		subscribe(onScroll) {
			el.addEventListener('scroll', onScroll, { passive: true });
			return () => el.removeEventListener('scroll', onScroll);
		}
	};
}

/** The page's own viewport. Measure and write come from different places on purpose, the split
 *  `selection/autoscroll.ts` makes: the viewport is the box the fold belongs to, whereas
 *  `document.scrollingElement` — whose box is the whole multi-thousand-pixel document — is the
 *  only thing that moves. */
function pageScrollport(): Omit<Scrollport, 'scrollBy'> {
	const scroller = () => document.scrollingElement;
	return {
		viewportTop: () => 0,
		viewportHeight: () => document.documentElement.clientHeight,
		contentWidth: () => document.documentElement.clientWidth,
		scrollTop: () => scroller()?.scrollTop ?? 0,
		setScrollTop: (value) => {
			const el = scroller();
			if (el) el.scrollTop = value;
		},
		subscribe(onScroll) {
			window.addEventListener('scroll', onScroll, { passive: true });
			return () => window.removeEventListener('scroll', onScroll);
		}
	};
}
