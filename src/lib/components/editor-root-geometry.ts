/**
 * The editor root's size observers: each watches the element it is handed and returns its
 * teardown, and the values they feed stay in `Editor.svelte`. ResizeObserver already batches
 * per callback, so there is no timer (G4.4).
 */

import type { UserScrollport } from '../windowing/scroll-ancestors';
import type { RootListScroll, ScrollOwner } from '../windowing/scroll-owner';
import { ESTIMATE_BASE_FONT_SIZE } from '../windowing/typography-estimates';
import { onRoot, removeAll } from './editor-root-listeners';

// ── Width and height ────────────────────────────────────────────────

/** Calls `onWidthChange` when `el`'s width changes. A height-only resize is ignored: only a
 *  re-wrap makes the measured heights wrong. */
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

/** Calls `bump` when the resolved scroll container `target` changes height. */
export function installViewportHeightWatcher(target: UserScrollport, bump: () => void): () => void {
	if (target === window) {
		// The page viewport has no box to observe, and a visualViewport change (a mobile URL
		// bar retracting) never touches documentElement's height, so both run unconditionally.
		const visual = window.visualViewport;
		return removeAll(
			onRoot(window, 'resize', bump),
			visual ? onRoot(visual, 'resize', bump) : () => {}
		);
	}
	// A cast, not a narrowing: `UserScrollport` is a union of object types, which `=== window`
	// does not narrow; `createScrollport` casts the same way at the same split.
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

/** A font-size change can throw the height estimates off enough that windowing never starts;
 *  the `1em` element reports it, as a scale against `HEIGHT_ESTIMATES`. */
export function installTypeScaleProbe(el: HTMLElement, deps: TypeScaleProbeDeps): () => void {
	const apply = (fontSizePx: number) => {
		const next = fontSizePx / ESTIMATE_BASE_FONT_SIZE;
		// A change under one percent is sub-pixel on a line box, not worth a full rebuild.
		if (!(next > 0) || Math.abs(next - deps.getScale()) < 0.01) return;
		deps.onScale(next);
	};
	apply(el.getBoundingClientRect().height);
	const observer = new ResizeObserver((entries) => apply(borderBoxHeight(entries, el)));
	observer.observe(el);
	return () => observer.disconnect();
}

// Border boxes throughout, first measurement and fallback alike, so a browser without
// `borderBoxSize` computes the same difference.
function borderBoxHeight(entries: ResizeObserverEntry[], el: HTMLElement): number {
	const box = entries[0]?.borderBoxSize?.[0];
	return box ? box.blockSize : el.getBoundingClientRect().height;
}

// ── Header height ───────────────────────────────────────────────────

// The header has already resized when its observer fires; there is no change left to run.
const noChange = (): void => {};

export interface HeaderSlotCompensationDeps {
	el: HTMLElement;
	port: ScrollOwner['port'];
	/** The root list's correction: a held target is re-placed, since the root list's top already
	 *  counts the header. */
	compensate: RootListScroll['compensate'];
}

/** The header is not in the height table, so its own resize adds to the scroll correction, or a
 *  growing header would slide the document. */
export function installHeaderSlotCompensation(deps: HeaderSlotCompensationDeps): () => void {
	const { el, port, compensate } = deps;
	let lastHeight = el.getBoundingClientRect().height;
	const observer = new ResizeObserver((entries) => {
		const height = borderBoxHeight(entries, el);
		const delta = height - lastHeight;
		lastHeight = height;
		if (delta === 0) return;
		// At the top the header is on screen, so the document moving down under it is expected.
		compensate(noChange, (run) => {
			run();
			return port()?.scrollTop() === 0 ? 0 : delta;
		});
	});
	observer.observe(el);
	return () => observer.disconnect();
}
