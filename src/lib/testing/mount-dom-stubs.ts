interface StubbableGlobals {
	ResizeObserver?: unknown;
}

class NoopResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

/**
 * Fills the two jsdom gaps a mounted editor hits, the block-height `ResizeObserver` and
 * `scrollIntoView`, once, before the first mount. Each is installed only where it is missing, so a
 * runner that supplies a real one keeps it and the call does nothing in a browser. Windowing
 * decides from estimated heights in either scroll mode, so keep fixture documents small when a
 * test asserts a block is mounted: jsdom reports a zero-height viewport and mounts only a few.
 */
export function installEditorDomStubsForTests(): void {
	const globals = globalThis as StubbableGlobals;
	globals.ResizeObserver ??= NoopResizeObserver;
	if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
		Element.prototype.scrollIntoView = () => {};
	}
}
