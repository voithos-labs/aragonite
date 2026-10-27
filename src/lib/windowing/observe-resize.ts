/**
 * Every ResizeObserver in the editor is made here (G4.240), so the browser's size-report quirks
 * are handled once. An element first observed while the browser delivers reports is skipped at
 * its depth and reported as a loop error, so a watcher that can start then waits a frame.
 */

/** Watches `el` from the next frame on, for a component that can mount during a delivery; the
 *  first report still carries the size as of that frame. Returns the disposer. */
export function observeResize(el: Element, onResize: ResizeObserverCallback): () => void {
	// jsdom has no ResizeObserver; callers keep their other measuring paths there.
	if (typeof ResizeObserver !== 'function') return () => {};
	const observer = new ResizeObserver(onResize);
	const frame = requestAnimationFrame(() => observer.observe(el));
	return () => {
		cancelAnimationFrame(frame);
		observer.disconnect();
	};
}

/** Watches `el` from now on, for a watcher set up outside a delivery (an editor-level one at
 *  mount); one that can start during a delivery uses `observeResize`. Returns the disposer. */
export function observeResizeNow(el: Element, onResize: ResizeObserverCallback): () => void {
	if (typeof ResizeObserver !== 'function') return () => {};
	const observer = new ResizeObserver(onResize);
	observer.observe(el);
	return () => observer.disconnect();
}

export interface SharedResizeWatch {
	/** Watches `el`'s border-box height from the next frame on; returns the disposer. */
	watch(el: Element, onHeight: (height: number) => void): () => void;
	/** Hands each watched element's size change that the browser has laid out but not reported yet
	 *  to its watchers now. The browser's own report of that size, when it comes, hands over nothing. */
	reportNow(): void;
}

/** A size report's border-box height, read off the element's border box where the engine gives
 *  no box, so a first measurement and every later report compare like with like. */
export function borderBoxHeight(entry: ResizeObserverEntry): number {
	const box = entry.borderBoxSize?.[0];
	return box ? box.blockSize : entry.target.getBoundingClientRect().height;
}

interface Size {
	width: number;
	height: number;
}

/** One observer for many elements, each watched from the next frame, made after the width watcher.
 *  Every watcher of an element hears each resize; the last one to stop unobserves it. */
export function createSharedResizeWatch(): SharedResizeWatch {
	const listeners = new Map<Element, Set<(height: number) => void>>();
	// The size each element's watchers last heard, from either route.
	const handed = new Map<Element, Size>();
	let observer: ResizeObserver | null = null;

	function handOver(el: Element, size: Size): void {
		const last = handed.get(el);
		if (last && last.width === size.width && last.height === size.height) return;
		handed.set(el, size);
		for (const onHeight of [...(listeners.get(el) ?? [])]) onHeight(size.height);
	}

	const deliver: ResizeObserverCallback = (entries) => {
		for (const entry of entries) {
			const box = entry.borderBoxSize?.[0];
			handOver(
				entry.target,
				box
					? { width: box.inlineSize, height: box.blockSize }
					: entry.target.getBoundingClientRect()
			);
		}
	};
	return {
		watch(el, onHeight) {
			if (typeof ResizeObserver !== 'function') return () => {};
			const watchers = listeners.get(el) ?? new Set();
			listeners.set(el, watchers);
			// A fresh function per watch, so the same callback watching twice stops one at a time.
			const watcher = (height: number) => onHeight(height);
			watchers.add(watcher);
			const frame = requestAnimationFrame(() => {
				observer ??= new ResizeObserver(deliver);
				observer.observe(el);
			});
			return () => {
				cancelAnimationFrame(frame);
				watchers.delete(watcher);
				if (watchers.size > 0 || listeners.get(el) !== watchers) return;
				listeners.delete(el);
				handed.delete(el);
				observer?.unobserve(el);
			};
		},
		reportNow() {
			for (const el of [...listeners.keys()]) {
				if (el.isConnected) handOver(el, el.getBoundingClientRect());
			}
		}
	};
}
