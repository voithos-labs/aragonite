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
	/** Fires on user and programmatic scrolls alike; returns the unsubscribe. */
	subscribe(onScroll: () => void): () => void;
}

export function createScrollport(target: UserScrollport): Scrollport {
	return target === window ? pageScrollport() : elementScrollport(target as HTMLElement);
}

// ── Internal ───────────────────────────────────────────────────────────────

function elementScrollport(el: HTMLElement): Scrollport {
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
function pageScrollport(): Scrollport {
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
