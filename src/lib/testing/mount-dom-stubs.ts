/**
 * For mounting the editor in a test: fills the gaps a mounted editor hits in a DOM you bring (jsdom),
 * each only where it's missing. It makes no DOM: call it once, under a DOM, before the first mount.
 * jsdom's viewport has no height, so few blocks mount: keep fixtures small when asserting one.
 */
export function headless(): void {
	const globals = globalThis as StubbableGlobals;
	globals.ResizeObserver ??= NoopResizeObserver;
	if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
		Element.prototype.scrollIntoView = () => {};
	}
	if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
		Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
		Range.prototype.getBoundingClientRect = () => new DOMRect();
	}
}

interface StubbableGlobals {
	ResizeObserver?: unknown;
}

class NoopResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}
