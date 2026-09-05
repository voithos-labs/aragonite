interface StubbableGlobals {
	ResizeObserver?: unknown;
}

class NoopResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

/**
 * Install the jsdom gaps a mounted editor hits — the block-height `ResizeObserver` and the
 * reveal's `scrollIntoView` — once, before the first mount. Each lands only where absent, so a
 * runner supplying a real one keeps it and the call is inert in a browser. Windowing activates
 * on ESTIMATED height in either scroll mode, so keep fixture documents small if a test asserts
 * on a block being mounted; jsdom reports a zero viewport and mounts only the first few.
 */
export function installEditorDomStubsForTests(): void {
	const globals = globalThis as StubbableGlobals;
	globals.ResizeObserver ??= NoopResizeObserver;
	if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
		Element.prototype.scrollIntoView = () => {};
	}
}
