interface StubbableGlobals {
	ResizeObserver?: unknown;
}

class NoopResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

/**
 * Fills the jsdom gaps a mounted editor hits (`ResizeObserver`, `scrollIntoView`, a range's
 * rects) where they are missing; call once before the first mount. jsdom's viewport has no
 * height, so only a few blocks mount: keep fixture documents small when a test asserts a block is
 * mounted.
 */
export function installEditorDomStubsForTests(): void {
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
