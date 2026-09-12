/**
 * Editor-root geometry observers: the width and viewport-height watchers, the type-scale probe
 * and the header-slot compensation. Each observes the element its installing `$effect`
 * captured and returns the teardown; the reactive signals they feed (`widthVersion`,
 * `typeScale`, `viewportHeightVersion`) stay in `Editor.svelte`, which is what the rest of the
 * root reads. ResizeObserver's per-callback batching is the coalescing; no timer debounce (G4.4).
 */

import type { UserScrollport } from '../cursor/scroll-ancestors';
import type { Scrollport } from '../cursor/scrollport';
import { ESTIMATE_BASE_FONT_SIZE } from '../cursor/typography-estimates';
import { onRoot, removeAll } from './editor-root-listeners';

// ── Width and height ────────────────────────────────────────────────

/** Calls `onWidthChange` when `el`'s width moves. A height-only resize is ignored: only a
 *  re-wrap stales the measured heights. */
export function installWidthWatcher(el: HTMLElement, onWidthChange: () => void): () => void {
	let lastWidth = el.clientWidth;
	const observer = new ResizeObserver(() => {
		const width = el.clientWidth;
		if (width === lastWidth) return;
		lastWidth = width;
		onWidthChange();
	});
	observer.observe(el);
	return () => observer.disconnect();
}

/** Calls `bump` on a height change of the resolved scrollport `target`. */
export function installViewportHeightWatcher(target: UserScrollport, bump: () => void): () => void {
	if (target === window) {
		// The page viewport has no box to observe, and a visualViewport move (a mobile URL
		// bar retracting) never touches documentElement's height — hence both, ungated.
		const visual = window.visualViewport;
		return removeAll(
			onRoot(window, 'resize', bump),
			visual ? onRoot(visual, 'resize', bump) : () => {}
		);
	}
	// Cast, not a narrowing: `UserScrollport` is a union of object types, which `=== window`
	// does not narrow — the same cast `createScrollport` makes on the same split.
	const el = target as HTMLElement;
	let lastHeight = el.clientHeight;
	const observer = new ResizeObserver(() => {
		if (el.clientHeight === lastHeight) return;
		lastHeight = el.clientHeight;
		bump();
	});
	observer.observe(el);
	return () => observer.disconnect();
}

// ── Type scale ──────────────────────────────────────────────────────

export interface TypeScaleProbeDeps {
	/** Read at each report, so the sub-percent guard compares against the scale in force. */
	getScale(): number;
	onScale(next: number): void;
}

/**
 * The width watcher's sibling: a font-size move puts the height estimates off several-fold, so
 * a document whose true height clears the activation watermark can fail to window at all. No
 * other box in the root reports it, hence the `1em` probe; the scale is relative to the size
 * `HEIGHT_ESTIMATES` were calibrated at.
 */
export function installTypeScaleProbe(el: HTMLElement, deps: TypeScaleProbeDeps): () => void {
	const apply = (fontSizePx: number) => {
		const next = fontSizePx / ESTIMATE_BASE_FONT_SIZE;
		// Sub-percent moves are sub-pixel on a line box — not worth a full rebuild.
		if (!(next > 0) || Math.abs(next - deps.getScale()) < 0.01) return;
		deps.onScale(next);
	};
	apply(el.getBoundingClientRect().height);
	const observer = new ResizeObserver((entries) => apply(borderBoxHeight(entries, el)));
	observer.observe(el);
	return () => observer.disconnect();
}

// Border boxes throughout, seed and fallback alike, so a browser without `borderBoxSize`
// computes the same delta.
function borderBoxHeight(entries: ResizeObserverEntry[], el: HTMLElement): number {
	const box = entries[0]?.borderBoxSize?.[0];
	return box ? box.blockSize : el.getBoundingClientRect().height;
}

// ── Header slot ─────────────────────────────────────────────────────

export interface HeaderSlotCompensationDeps {
	el: HTMLElement;
	port: Pick<Scrollport, 'scrollTop' | 'setScrollTop'>;
	ownsScrollCorrection(): boolean;
	revealHoldsScroll(): boolean;
}

/**
 * The header slot's height lives outside the height model, so while the editor owns the
 * correction a growing header would slide the document under the reader. Compensating from
 * the SLOT's own resize composes with `correctAnchor` instead of double-correcting; a reveal
 * already holding the scroll outranks it.
 */
export function installHeaderSlotCompensation(deps: HeaderSlotCompensationDeps): () => void {
	const { el, port } = deps;
	let lastHeight = el.getBoundingClientRect().height;
	const observer = new ResizeObserver((entries) => {
		const height = borderBoxHeight(entries, el);
		const delta = height - lastHeight;
		lastHeight = height;
		if (delta === 0 || !deps.ownsScrollCorrection() || port.scrollTop() === 0) return;
		if (!deps.revealHoldsScroll()) port.setScrollTop(port.scrollTop() + delta);
	});
	observer.observe(el);
	return () => observer.disconnect();
}
