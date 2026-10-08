/**
 * Watches one element's size for a component that can mount while the browser delivers resize
 * notifications. An element first observed during that delivery is skipped at its depth and
 * reported as a ResizeObserver loop error, so observation starts at the next frame; the first
 * notification then still carries the element's size as of that frame. Returns the disposer.
 */
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

export interface SharedResizeWatch {
	/** Watches `el` from the next frame on; returns the disposer. */
	watch(el: Element, onResize: (entry: ResizeObserverEntry) => void): () => void;
}

/** One observer for many elements, each watched from the next frame, made after the width watcher.
 *  Every watcher of an element hears each resize; the last one to stop unobserves it. */
export function createSharedResizeWatch(): SharedResizeWatch {
	const listeners = new Map<Element, Set<(entry: ResizeObserverEntry) => void>>();
	let observer: ResizeObserver | null = null;
	const deliver: ResizeObserverCallback = (entries) => {
		for (const entry of entries) {
			for (const onResize of [...(listeners.get(entry.target) ?? [])]) onResize(entry);
		}
	};
	return {
		watch(el, onResize) {
			if (typeof ResizeObserver !== 'function') return () => {};
			const watchers = listeners.get(el) ?? new Set();
			listeners.set(el, watchers);
			// A fresh function per watch, so the same callback watching twice stops one at a time.
			const watcher = (entry: ResizeObserverEntry) => onResize(entry);
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
				observer?.unobserve(el);
			};
		}
	};
}
