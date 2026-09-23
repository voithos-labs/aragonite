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
