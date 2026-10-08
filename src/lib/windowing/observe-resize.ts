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

/** One observer for many elements, each watched from the next frame, made after the width watcher. */
export function createSharedResizeWatch(): SharedResizeWatch {
	const listeners = new Map<Element, (entry: ResizeObserverEntry) => void>();
	let observer: ResizeObserver | null = null;
	const deliver: ResizeObserverCallback = (entries) => {
		for (const entry of entries) listeners.get(entry.target)?.(entry);
	};
	return {
		watch(el, onResize) {
			if (typeof ResizeObserver !== 'function') return () => {};
			listeners.set(el, onResize);
			const frame = requestAnimationFrame(() => {
				observer ??= new ResizeObserver(deliver);
				observer.observe(el);
			});
			return () => {
				cancelAnimationFrame(frame);
				observer?.unobserve(el);
				if (listeners.get(el) === onResize) listeners.delete(el);
			};
		}
	};
}
