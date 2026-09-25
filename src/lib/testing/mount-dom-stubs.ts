interface StubbableGlobals {
	ResizeObserver?: unknown;
}

class NoopResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

/**
 * Fills the two jsdom gaps a mounted editor hits (`ResizeObserver`, `scrollIntoView`) where they
 * are missing; call once before the first mount. jsdom's viewport has no height, so only a few
 * blocks mount: keep fixture documents small when a test asserts a block is mounted.
 */
export function installEditorDomStubsForTests(): void {
	const globals = globalThis as StubbableGlobals;
	globals.ResizeObserver ??= NoopResizeObserver;
	if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
		Element.prototype.scrollIntoView = () => {};
	}
}
