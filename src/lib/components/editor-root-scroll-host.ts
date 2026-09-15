/**
 * Editor-root scroll resolution: what a drag autoscrolls, what bounds the visible region, and
 * the scrollport windowing measures and writes, all over the ONE scroller the mode picks, so
 * nothing downstream branches on the mode. Host mode asks two questions one walk cannot serve
 * (`cursor/scroll-ancestors` header); both memoize on first read, so a host that swaps its
 * scroller must remount.
 */

import {
	clippingAncestors,
	userScrollportFor,
	type UserScrollport
} from '../cursor/scroll-ancestors';
import { createScrollport, type Scrollport } from '../cursor/scrollport';

export interface ScrollHostDeps {
	/** A getter, never a value: the root binds after construction. */
	get editorEl(): HTMLElement | undefined;
	/** Set once: a live read inside the windowing scopes' derived would make the mode a
	 *  dependency of the hottest path. */
	hostScroll: boolean;
}

export interface ScrollHostResolution {
	/** The root in self mode, the nearest user-scrollable ancestor in host mode. Null only
	 *  before the root mounts. */
	getScrollHost(): UserScrollport | null;
	/** Every clipping ancestor; their intersection with the viewport is what a reveal must
	 *  land inside. Empty in self mode. */
	getClipBounds(): HTMLElement[];
	getScrollport(): Scrollport | null;
}

export function createScrollHostResolution(deps: ScrollHostDeps): ScrollHostResolution {
	let resolvedScrollHost: UserScrollport | null = null;
	let resolvedClipBounds: HTMLElement[] = [];
	let hostResolved = false;
	let scrollport: Scrollport | null = null;

	function resolveHost(): void {
		const root = deps.editorEl;
		if (hostResolved || !root) return;
		resolvedScrollHost = userScrollportFor(root);
		resolvedClipBounds = clippingAncestors(root);
		hostResolved = true;
	}

	function getScrollHost(): UserScrollport | null {
		if (!deps.hostScroll) return deps.editorEl ?? null;
		resolveHost();
		return resolvedScrollHost;
	}

	return {
		getScrollHost,
		getClipBounds() {
			if (!deps.hostScroll) return [];
			resolveHost();
			return resolvedClipBounds;
		},
		getScrollport() {
			if (!scrollport) {
				const target = getScrollHost();
				if (target) scrollport = createScrollport(target);
			}
			return scrollport;
		}
	};
}
